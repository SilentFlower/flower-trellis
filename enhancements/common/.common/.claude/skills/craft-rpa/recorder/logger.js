/**
 * 本地日志与浏览器控制服务。
 *
 * `/log` 接收注入脚本的兼容回退事件；正常路径由 Playwright binding
 * 直接调用 `server.appendEvents`，因此不依赖目标页面访问 localhost。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DEFAULT_HOST, getLoggerOrigin, resolvePort } = require('./config');

const DEFAULT_LOG_FILE = path.resolve(process.env.CRAFT_RPA_SESSION_FILE || path.join(__dirname, 'session.jsonl'));
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
const DASHBOARD_OMITTED_FIELDS = new Set([
    'requestBody',
    'responseBody',
    'requestHeaders',
    'responseHeaders',
    'requestMultipart',
]);

/**
 * 生成 Dashboard 使用的轻量事件，原始敏感内容只保留在本地 JSONL。
 *
 * @param {Object} event 原始事件。
 * @param {number} cursor 单调递增游标。
 * @return {Object} 不含大正文和完整头的事件摘要。
 */
function summarizeDashboardEvent(event, cursor) {
    const summary = { _cursor: cursor };
    for (const [key, value] of Object.entries(event)) {
        if (!DASHBOARD_OMITTED_FIELDS.has(key)) summary[key] = value;
    }
    if (event.requestHeaders) summary.requestHeaderCount = Object.keys(event.requestHeaders).length;
    if (event.responseHeaders) summary.responseHeaderCount = Object.keys(event.responseHeaders).length;
    if (event.requestBody !== undefined && event.requestBody !== null) summary.requestBodyCaptured = true;
    if (event.responseBody !== undefined && event.responseBody !== null) summary.responseBodyCaptured = true;
    if (event.requestMultipart) summary.requestMultipartPartCount = event.requestMultipart.parts?.length || 0;
    return summary;
}

/**
 * 判断请求 Origin 是否允许访问控制或事件读取接口。
 *
 * @param {string|undefined} origin 请求 Origin。
 * @param {string|undefined} host 请求 Host。
 * @return {boolean} 是否允许。
 */
function isProtectedOriginAllowed(origin, host) {
    if (!origin) return true;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch (error) {
        return false;
    }
    if (parsed.host === host) return true;
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
}

/**
 * 读取有大小上限的 JSON body。
 *
 * @param {http.IncomingMessage} req HTTP 请求。
 * @return {Promise<Object>} JSON 对象。
 */
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        req.on('data', chunk => {
            if (settled) return;
            size += chunk.length;
            if (size > MAX_JSON_BODY_BYTES) {
                settled = true;
                chunks.length = 0;
                reject(Object.assign(new Error('request body too large'), { statusCode: 413, code: 'BODY_TOO_LARGE' }));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            settled = true;
            if (chunks.length === 0) return resolve({});
            try {
                return resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (error) {
                error.statusCode = 400;
                error.code = 'INVALID_JSON';
                return reject(error);
            }
        });
        req.on('error', error => {
            if (settled) return;
            settled = true;
            reject(error);
        });
    });
}

/**
 * 写 JSON 响应。
 *
 * @param {http.ServerResponse} res HTTP 响应。
 * @param {number} statusCode 状态码。
 * @param {Object|Array<Object>} payload 响应数据。
 * @return {void}
 */
function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

/**
 * 启动本地日志收集与浏览器控制服务。
 *
 * @param {Object} [options] 配置项。
 * @param {number} [options.port] 监听端口。
 * @param {string} [options.host] 监听地址。
 * @param {string} [options.logFile] JSONL 文件路径。
 * @param {{dispatch:(action:string,body:Object)=>Promise<Object>}} [options.browserController] 浏览器控制器。
 * @return {http.Server & {appendEvents:(events:Array<Object>|Object)=>void}} 已启动且保持 `.close()` 兼容的 server。
 */
function startLogger(options = {}) {
    const port = resolvePort(options.port);
    const host = options.host || DEFAULT_HOST;
    const logFile = options.logFile || DEFAULT_LOG_FILE;
    const browserController = options.browserController || null;
    const dashboardFile = path.join(__dirname, 'dashboard.html');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.closeSync(fs.openSync(logFile, 'a'));
    let dashboardEvents = null;

    /**
     * 追加一批事件，每个对象独占一行。
     *
     * @param {Array<Object>|Object} input 单条事件或事件数组。
     * @return {void}
     */
    function appendEvents(input) {
        const events = Array.isArray(input) ? input : [input];
        const validEvents = events.filter(event => event && typeof event === 'object' && !Array.isArray(event));
        if (validEvents.length === 0) return;
        const persistedEvents = validEvents.map(event => ({ ...event, serverTime: new Date().toISOString() }));
        const lines = persistedEvents.map(event => JSON.stringify(event)).join('\n') + '\n';
        fs.appendFileSync(logFile, lines);
        if (dashboardEvents) {
            for (const event of persistedEvents) {
                dashboardEvents.push(summarizeDashboardEvent(event, dashboardEvents.length + 1));
            }
        }
    }

    /**
     * 读取全部有效 JSONL 事件。
     *
     * @return {Array<Object>} 事件列表。
     */
    function readDashboardEvents() {
        if (dashboardEvents) return dashboardEvents;
        const events = [];
        for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                events.push(summarizeDashboardEvent(JSON.parse(line), events.length + 1));
            } catch (error) {
                // 单行损坏不应影响其它可复现事件。
            }
        }
        dashboardEvents = events;
        return dashboardEvents;
    }

    /**
     * 为 `/log` 回退或受保护接口设置各自的 CORS 头。
     *
     * @param {http.IncomingMessage} req HTTP 请求。
     * @param {http.ServerResponse} res HTTP 响应。
     * @param {'log'|'protected'|'none'} policy 路由策略。
     * @return {boolean} 当前 Origin 是否允许继续处理。
     */
    function applyOriginPolicy(req, res, policy) {
        const origin = req.headers.origin;
        if (policy === 'none') return true;
        if (policy === 'protected' && !isProtectedOriginAllowed(origin, req.headers.host)) return false;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (policy === 'log' && req.headers['access-control-request-private-network']) {
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        return true;
    }

    /**
     * 执行 browser controller action 并统一错误结构。
     *
     * @param {string} action 动作名。
     * @param {http.IncomingMessage} req HTTP 请求。
     * @param {http.ServerResponse} res HTTP 响应。
     * @return {Promise<void>} 完成响应后结束。
     */
    async function handleControl(action, req, res) {
        if (!browserController) {
            writeJson(res, 503, { error: { code: 'BROWSER_NOT_READY', message: 'browser controller 未配置', details: null } });
            return;
        }
        try {
            const body = req.method === 'POST' ? await readJsonBody(req) : Object.fromEntries(new URL(req.url, getLoggerOrigin({ port })).searchParams);
            const result = await browserController.dispatch(action, body);
            writeJson(res, 200, result === undefined ? { ok: true } : result);
        } catch (error) {
            console.error('[control]', action, 'failed:', error.message);
            writeJson(res, error.statusCode || 500, {
                error: {
                    code: error.code || 'CONTROL_FAILED',
                    message: error.message,
                    details: error.details || null,
                },
            });
        }
    }

    const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url, getLoggerOrigin({ port }));
        const pathname = reqUrl.pathname;
        const isControl = pathname.startsWith('/control/');
        const isEvents = pathname === '/events';
        const isSession = pathname === '/session';
        const policy = pathname === '/log' ? 'log' : (isControl || isEvents || isSession ? 'protected' : 'none');
        if (!applyOriginPolicy(req, res, policy)) {
            writeJson(res, 403, { error: { code: 'ORIGIN_FORBIDDEN', message: 'cross-origin control access is forbidden', details: null } });
            return;
        }
        if (req.method === 'OPTIONS') {
            if (policy === 'none') {
                res.writeHead(404);
            } else {
                res.writeHead(204);
            }
            res.end();
            return;
        }
        if (req.method === 'GET' && pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (isControl) {
            if (!['GET', 'POST'].includes(req.method)) {
                writeJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'control only supports GET or POST', details: null } });
                return;
            }
            void handleControl(pathname.slice('/control/'.length), req, res);
            return;
        }
        if (req.method === 'GET' && (pathname === '/dashboard' || pathname === '/dashboard.html')) {
            if (!fs.existsSync(dashboardFile)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('dashboard.html 未找到');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(dashboardFile, 'utf8'));
            return;
        }
        if (req.method === 'GET' && pathname === '/events') {
            const since = reqUrl.searchParams.get('since');
            const cursor = Number.parseInt(reqUrl.searchParams.get('cursor'), 10);
            const limit = Number.parseInt(reqUrl.searchParams.get('limit'), 10);
            let events = readDashboardEvents();
            if (cursor > 0) events = events.filter(event => event._cursor > cursor);
            if (since) events = events.filter(event => event.serverTime > since);
            if (limit > 0 && events.length > limit) events = events.slice(-limit);
            writeJson(res, 200, events);
            return;
        }
        if (req.method === 'GET' && pathname === '/session') {
            res.writeHead(200, {
                'Content-Type': 'application/x-ndjson; charset=utf-8',
                'Content-Disposition': `attachment; filename="${path.basename(logFile)}"`,
                'Content-Length': fs.statSync(logFile).size,
            });
            fs.createReadStream(logFile).pipe(res);
            return;
        }
        if (req.method === 'POST' && pathname === '/log') {
            readJsonBody(req).then(payload => {
                appendEvents(payload);
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('ok');
            }).catch(error => {
                console.error('[logger] bad payload:', error.message);
                writeJson(res, error.statusCode || 400, {
                    error: { code: error.code || 'INVALID_PAYLOAD', message: error.message, details: null },
                });
            });
            return;
        }
        if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
            writeJson(res, 200, {
                status: 'ok',
                logFile,
                endpoints: {
                    dashboard: `${getLoggerOrigin({ port })}/dashboard`,
                    events: `${getLoggerOrigin({ port })}/events`,
                    session: `${getLoggerOrigin({ port })}/session`,
                    log: `${getLoggerOrigin({ port })}/log`,
                    control: `${getLoggerOrigin({ port })}/control/<action>`,
                },
            });
            return;
        }
        writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'route not found', details: null } });
    });

    server.appendEvents = appendEvents;
    server.listen(port, host, () => {
        console.log(`[logger] listening on ${getLoggerOrigin({ port })}  (also ${host}:${port})`);
        console.log(`[logger] writing to    ${logFile}`);
        console.log(`[logger] dashboard at  ${getLoggerOrigin({ port })}/dashboard`);
        console.log(`[logger] live view:    tail -f ${logFile}`);
    });
    return server;
}

if (require.main === module) startLogger();

module.exports = { isProtectedOriginAllowed, readJsonBody, startLogger, summarizeDashboardEvent };
