/**
 * 本地日志收集服务
 *
 * 职责：
 *   接收浏览器注入脚本通过 fetch / sendBeacon 发来的事件，
 *   按 JSONL（每行一条 JSON）格式实时追加写入 session.jsonl。
 *
 * 启动方式：
 *   node logger.js
 *
 * 实时查看：
 *   tail -f session.jsonl
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 7777;
const DEFAULT_LOG_FILE = path.resolve(
    process.env.CRAFT_RPA_SESSION_FILE || path.join(__dirname, 'session.jsonl'),
);

/**
 * 启动本地日志收集服务
 *
 * 既可作为独立脚本运行（node logger.js），
 * 也可被 launch.js 通过 require 调用，从而实现"一条命令同时起日志和浏览器"。
 *
 * @param {Object} [options] 配置项
 * @param {number} [options.port=7777] 监听端口
 * @param {string} [options.logFile] 日志文件绝对路径，默认 ./session.jsonl
 * @param {Object} [options.browserController] 浏览器控制器，传入后开启 /control/* 接口
 *        让 Dashboard 直接控制浏览器（打开 URL、切 tab、关闭、刷新等）。
 *        需要提供方法：open/listPages/close/focus/reload/back/forward/navigate
 * @return {http.Server} 已启动的 HTTP server 实例（方便调用方关闭）
 */
function startLogger(options = {}) {
    const port = options.port || DEFAULT_PORT;
    const logFile = options.logFile || DEFAULT_LOG_FILE;
    const browserController = options.browserController || null;

    /**
     * 把一批事件追加写入日志文件
     * @param {Array<Object>} events 事件数组，每个事件会单独成行
     */
    function appendEvents(events) {
        // 给每条事件补一个服务端时间戳，用于和客户端时间对齐排查时钟漂移
        const lines = events
            .map(e => JSON.stringify({ ...e, serverTime: new Date().toISOString() }))
            .join('\n') + '\n';
        fs.appendFileSync(logFile, lines);
    }

    const dashboardFile = path.join(__dirname, 'dashboard.html');

    /**
     * 读取 POST 请求的 JSON body
     * @param {http.IncomingMessage} req
     * @return {Promise<Object>}
     */
    function readJsonBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
                if (!body) return resolve({});
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(e); }
            });
            req.on('error', reject);
        });
    }

    /**
     * 处理 /control/* 路由：把请求转发给 browserController
     * 这是 Dashboard 控制浏览器的唯一通道
     * @param {string} action 动作名（去掉 /control/ 前缀后的部分）
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     */
    async function handleControl(action, req, res) {
        if (!browserController) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'browser controller 未配置（独立运行 logger 不支持控制）' }));
            return;
        }
        try {
            const body = req.method === 'POST' ? await readJsonBody(req) : {};
            let result;
            switch (action) {
                case 'open':     result = await browserController.open(body.url, body); break;
                case 'pages':    result = await browserController.listPages(); break;
                case 'close':    result = await browserController.close(body.index); break;
                case 'focus':    result = await browserController.focus(body.index); break;
                case 'reload':   result = await browserController.reload(body.index); break;
                case 'back':     result = await browserController.back(body.index); break;
                case 'forward':  result = await browserController.forward(body.index); break;
                case 'navigate': result = await browserController.navigate(body.index, body.url); break;
                default:
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'unknown control action: ' + action }));
                    return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result || { ok: true }));
        } catch (err) {
            console.error('[control]', action, 'failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
    }

    /**
     * 读取日志文件并解析成事件数组
     * 文件不存在时返回空数组；个别行解析失败会被跳过
     * @return {Array<Object>}
     */
    function readAllEvents() {
        if (!fs.existsSync(logFile)) return [];
        const lines = fs.readFileSync(logFile, 'utf8').split('\n');
        const events = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            try { events.push(JSON.parse(line)); } catch (e) { /* skip malformed */ }
        }
        return events;
    }

    const server = http.createServer((req, res) => {
        // CORS：注入脚本会跑在任意目标网站，必须支持跨域
        //
        // 关键：不能用通配符 '*'，因为 sendBeacon / 某些带 cookie 的 fetch
        // 会以 credentials='include' 发请求，浏览器规定此场景下
        // Access-Control-Allow-Origin 必须是具体 origin，且必须配合 Allow-Credentials=true。
        // 解决方案：把请求方的 Origin 原样回显，并允许携带 credentials。
        // Vary: Origin 告知缓存层"响应内容随 Origin 变化"，避免缓存串号。
        const reqOrigin = req.headers.origin || '*';
        res.setHeader('Access-Control-Allow-Origin', reqOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        // Chrome Private Network Access：从"公网"页面访问"本地网络"资源时浏览器会做预检
        // 即使 dashboard 也在 localhost 上，某些代理/转发场景可能触发，直接放行
        if (req.headers['access-control-request-private-network']) {
            res.setHeader('Access-Control-Allow-Private-Network', 'true');
        }

        // 预检请求直接放行
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // 解析 URL，做基于路径的路由
        const reqUrl = new URL(req.url, `http://localhost:${port}`);
        const pathname = reqUrl.pathname;

        // 静音 favicon 噪音
        if (req.method === 'GET' && pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }

        // /control/* ：浏览器控制接口（POST 操作 / GET 查询）
        if (pathname.startsWith('/control/')) {
            const action = pathname.replace('/control/', '');
            handleControl(action, req, res);
            return;
        }

        // GET /dashboard ：返回 HTML 实时面板
        if (req.method === 'GET' && (pathname === '/dashboard' || pathname === '/dashboard.html')) {
            if (!fs.existsSync(dashboardFile)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('dashboard.html 未找到');
                return;
            }
            const html = fs.readFileSync(dashboardFile, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        // GET /events ：返回事件列表 JSON，供 Dashboard 轮询
        // 支持 ?since=<serverTime ISO>（增量拉取） 和 ?limit=N（只要最近 N 条）
        if (req.method === 'GET' && pathname === '/events') {
            const since = reqUrl.searchParams.get('since');
            const limit = parseInt(reqUrl.searchParams.get('limit'), 10);
            let events = readAllEvents();
            if (since) events = events.filter(e => e.serverTime > since);
            if (limit > 0 && events.length > limit) events = events.slice(-limit);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(events));
            return;
        }

        // GET / 或 /health：健康检查 + 入口链接
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                logFile,
                endpoints: {
                    dashboard: `http://localhost:${port}/dashboard`,
                    events: `http://localhost:${port}/events`,
                    log: `http://localhost:${port}/log  (POST)`,
                },
            }));
            return;
        }

        // POST /log（或任意 POST 路径）：接收事件
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    // 客户端可能批量发送（数组），也可能单条发送（对象），统一成数组处理
                    const parsed = JSON.parse(body);
                    const events = Array.isArray(parsed) ? parsed : [parsed];
                    appendEvents(events);
                    res.writeHead(200);
                    res.end('ok');
                } catch (err) {
                    // 解析失败时把原始 body 也记下来便于排查
                    console.error('[logger] bad payload:', err.message);
                    res.writeHead(400);
                    res.end(err.message);
                }
            });
            return;
        }

        res.writeHead(405);
        res.end();
    });

    // 监听 0.0.0.0 而非 127.0.0.1：
    // WSL2 的 NAT 模式下，绑定 127.0.0.1 时 Windows 主机访问会走奇怪路径，
    // 可能导致同源判断失败 / CORS 报错。绑 0.0.0.0 让 Windows 主机能直接访问。
    // 本工具是本地开发用，端口高且仅供自用，没有安全风险。
    server.listen(port, '0.0.0.0', () => {
        console.log(`[logger] listening on http://localhost:${port}  (also 0.0.0.0:${port})`);
        console.log(`[logger] writing to    ${logFile}`);
        console.log(`[logger] dashboard at  http://localhost:${port}/dashboard`);
        console.log(`[logger] live view:    tail -f ${logFile}`);
    });

    return server;
}

// 作为独立脚本运行时直接启动；被 require 时只暴露函数
if (require.main === module) {
    startLogger();
}

module.exports = { startLogger };
