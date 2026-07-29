const { TextDecoder } = require('util');
const { MAX_NETWORK_BODY_BYTES } = require('./config');

const TEXT_CONTENT_TYPE_RE = /^(text\/)|json|xml|javascript|ecmascript|graphql|x-www-form-urlencoded|svg/i;
const BINARY_CONTENT_TYPE_RE = /^(image|audio|video|font)\/|octet-stream|zip|gzip|pdf|wasm/i;
const RECORDER_PATHS = new Set(['/log', '/events', '/session', '/dashboard', '/dashboard.html', '/health']);

/**
 * 判断 URL 是否属于 recorder 自身流量。
 *
 * @param {string} rawUrl 请求 URL。
 * @param {Object} [options] 过滤配置。
 * @param {number} [options.port] logger 端口。
 * @param {string[]} [options.hosts] 允许识别为本机的主机名。
 * @return {boolean} 是否应从业务网络事件中排除。
 */
function isRecorderRequest(rawUrl, options = {}) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch (error) {
        return false;
    }
    const hosts = new Set(options.hosts || ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
    const port = Number(options.port || 7777);
    const actualPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    const ownPath = RECORDER_PATHS.has(url.pathname) || url.pathname.startsWith('/control/');
    return hosts.has(url.hostname) && actualPort === port && ownPath;
}

/**
 * 在字节上限内截取合法 UTF-8 文本。
 *
 * @param {Buffer} buffer 原始字节。
 * @param {number} maxBytes 最大字节数。
 * @return {{text:string,size:number,truncated:boolean}} 截取结果。
 */
function truncateUtf8(buffer, maxBytes) {
    const size = buffer.length;
    const candidate = buffer.subarray(0, Math.min(size, maxBytes));
    const decoded = new TextDecoder('utf-8').decode(candidate);
    const validBuffer = Buffer.from(decoded, 'utf8');
    if (validBuffer.length <= maxBytes) {
        return { text: decoded, size, truncated: size > maxBytes };
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let end = maxBytes; end >= Math.max(0, maxBytes - 4); end -= 1) {
        try {
            return { text: decoder.decode(validBuffer.subarray(0, end)), size, truncated: true };
        } catch (error) {
            // UTF-8 字符最多四字节，只需回退到当前字符起点。
        }
    }
    return { text: '', size, truncated: true };
}

/**
 * 判断无 Content-Type 的请求正文是否像可打印 UTF-8 文本。
 *
 * @param {Buffer} buffer 原始字节。
 * @return {boolean} 是否可作为文本保存。
 */
function isProbablyText(buffer) {
    if (buffer.length === 0) return true;
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (error) {
        return false;
    }
    let controls = 0;
    for (const char of text) {
        const code = char.codePointAt(0);
        if ((code >= 0 && code < 9) || (code > 13 && code < 32)) controls += 1;
    }
    return controls / Math.max(1, text.length) < 0.02;
}

/**
 * 解析 multipart 的字段和文件元数据，不保存文件正文。
 *
 * @param {Buffer} buffer multipart 原始字节。
 * @param {string} contentType Content-Type。
 * @param {number} maxBytes 普通字段最大保存字节数。
 * @return {{parts:Array<Object>,parsed:boolean,reason?:string}} 解析结果。
 */
function parseMultipartMetadata(buffer, contentType, maxBytes) {
    const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    const boundary = match && (match[1] || match[2] || '').trim();
    if (!boundary) return { parts: [], parsed: false, reason: 'multipart-missing-boundary' };

    const raw = buffer.toString('latin1');
    const chunks = raw.split(`--${boundary}`).slice(1, -1);
    const parts = [];
    for (const chunk of chunks.slice(0, 100)) {
        const normalized = chunk.replace(/^\r\n/, '').replace(/\r\n$/, '');
        const splitAt = normalized.indexOf('\r\n\r\n');
        if (splitAt < 0) return { parts, parsed: false, reason: 'multipart-unparsed' };
        const headerText = normalized.slice(0, splitAt);
        const bodyText = normalized.slice(splitAt + 4);
        const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]+)/i);
        const name = disposition && /name="([^"]*)"/i.exec(disposition[1]);
        const filename = disposition && /filename="([^"]*)"/i.exec(disposition[1]);
        const type = /content-type:\s*([^\r\n]+)/i.exec(headerText);
        const bodyBuffer = Buffer.from(bodyText, 'latin1');
        if (filename) {
            parts.push({
                name: name ? name[1] : '',
                filename: filename[1],
                contentType: type ? type[1].trim() : '',
                size: bodyBuffer.length,
                fileBodySkipped: true,
            });
        } else {
            const captured = truncateUtf8(bodyBuffer, maxBytes);
            parts.push({
                name: name ? name[1] : '',
                value: captured.text,
                size: captured.size,
                truncated: captured.truncated,
            });
        }
    }
    return { parts, parsed: chunks.length <= 100, reason: chunks.length > 100 ? 'multipart-part-limit' : undefined };
}

/**
 * 按内容类型和字节上限生成正文捕获字段。
 *
 * @param {Buffer|null|undefined} input 原始正文。
 * @param {string} contentType Content-Type。
 * @param {Object} [options] 捕获配置。
 * @param {number} [options.maxBytes] 最大正文字节数。
 * @param {boolean} [options.allowUnknownText] 是否允许推断无类型请求正文。
 * @return {Object} 正文、大小、截断或跳过信息。
 */
function captureBody(input, contentType, options = {}) {
    if (input === null || input === undefined) return { size: 0, body: null, truncated: false };
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const maxBytes = options.maxBytes || MAX_NETWORK_BODY_BYTES;
    const normalizedType = String(contentType || '').toLowerCase();
    if (normalizedType.includes('multipart/form-data')) {
        const metadata = parseMultipartMetadata(buffer, String(contentType || ''), Math.min(maxBytes, 64 * 1024));
        return {
            size: buffer.length,
            body: null,
            truncated: false,
            bodySkipped: metadata.parsed ? 'multipart-metadata-only' : metadata.reason,
            multipart: metadata.parts,
        };
    }
    if (BINARY_CONTENT_TYPE_RE.test(normalizedType)) {
        return { size: buffer.length, body: null, truncated: false, bodySkipped: 'binary-content-type' };
    }
    const explicitText = TEXT_CONTENT_TYPE_RE.test(normalizedType);
    const inferredText = !normalizedType && options.allowUnknownText && isProbablyText(buffer);
    if (!explicitText && !inferredText) {
        return { size: buffer.length, body: null, truncated: false, bodySkipped: normalizedType ? 'unsupported-content-type' : 'missing-content-type' };
    }
    const captured = truncateUtf8(buffer, maxBytes);
    return { size: captured.size, body: captured.text, truncated: captured.truncated };
}

/**
 * 安装 BrowserContext 级 Fetch/XHR 网络采集。
 *
 * @param {import('playwright').BrowserContext} context Playwright BrowserContext。
 * @param {Object} options 采集配置。
 * @param {(events:Array<Object>)=>void|Promise<void>} options.appendEvents JSONL 追加回调。
 * @param {number} [options.port] logger 端口，用于过滤自身请求。
 * @param {number} [options.maxBodyBytes] 单方向正文上限。
 * @return {{dispose:()=>void}} 可移除监听器的句柄。
 */
function installNetworkCapture(context, options) {
    if (!options || typeof options.appendEvents !== 'function') {
        throw new TypeError('appendEvents callback is required');
    }
    const requestStates = new WeakMap();
    let sequence = 0;

    function onRequest(request) {
        if (!['fetch', 'xhr'].includes(request.resourceType())) return;
        if (isRecorderRequest(request.url(), { port: options.port })) return;
        const redirectedFrom = request.redirectedFrom();
        const redirectedState = redirectedFrom ? requestStates.get(redirectedFrom) : null;
        requestStates.set(request, {
            requestId: `net-${++sequence}`,
            redirectedFromRequestId: redirectedState ? redirectedState.requestId : null,
            startedAt: Date.now(),
            clientTime: new Date().toISOString(),
            finalized: false,
        });
    }

    async function finalize(request, terminal) {
        const state = requestStates.get(request);
        if (!state || state.finalized) return;
        state.finalized = true;
        const completedAt = Date.now();
        let frame = null;
        let serviceWorker = null;
        try { frame = request.frame(); } catch (error) { /* Service Worker 请求没有 frame。 */ }
        try { serviceWorker = request.serviceWorker(); } catch (error) { /* 旧 Playwright 不提供该方法。 */ }
        let frameDepth = null;
        let pageUrl = null;
        if (frame) {
            frameDepth = 0;
            for (let parent = frame.parentFrame(); parent; parent = parent.parentFrame()) frameDepth += 1;
            try { pageUrl = frame.page().url(); } catch (error) { pageUrl = null; }
        }

        let requestHeaders = {};
        let requestHeaderError = null;
        try { requestHeaders = await request.allHeaders(); } catch (error) { requestHeaderError = error.message; }
        const requestContentType = requestHeaders['content-type'] || '';
        let requestBody;
        try {
            requestBody = captureBody(request.postDataBuffer(), requestContentType, {
                maxBytes: options.maxBodyBytes,
                allowUnknownText: true,
            });
        } catch (error) {
            requestBody = { size: 0, body: null, truncated: false, captureError: error.message };
        }

        let response = terminal.response || null;
        if (!response && terminal.kind === 'finished') {
            try { response = await request.response(); } catch (error) { response = null; }
        }
        let responseHeaders = {};
        let responseHeaderError = null;
        let responseBody = { size: 0, body: null, truncated: false };
        if (response) {
            try { responseHeaders = await response.allHeaders(); } catch (error) { responseHeaderError = error.message; }
            const responseContentType = responseHeaders['content-type'] || '';
            const declaredSize = Number.parseInt(responseHeaders['content-length'], 10);
            const maxBodyBytes = options.maxBodyBytes || MAX_NETWORK_BODY_BYTES;
            if (Number.isFinite(declaredSize) && declaredSize > maxBodyBytes) {
                // Playwright 的 response.body() 会一次性物化完整响应；已知超限时直接跳过，避免先占满内存再截断。
                responseBody = {
                    size: declaredSize,
                    body: null,
                    truncated: true,
                    bodySkipped: 'content-length-exceeds-capture-limit',
                };
            } else {
                try {
                    responseBody = captureBody(await response.body(), responseContentType, {
                        maxBytes: maxBodyBytes,
                        allowUnknownText: false,
                    });
                } catch (error) {
                    responseBody = { size: 0, body: null, truncated: false, captureError: error.message };
                }
            }
        }

        const failure = terminal.failure || null;
        const event = {
            kind: 'network',
            type: request.resourceType(),
            source: 'playwright',
            requestId: state.requestId,
            redirectedFromRequestId: state.redirectedFromRequestId,
            clientTime: state.clientTime,
            completedTime: new Date(completedAt).toISOString(),
            durationMs: completedAt - state.startedAt,
            method: request.method(),
            requestUrl: request.url(),
            requestHeaders,
            requestHeaderCaptureError: requestHeaderError,
            requestContentType,
            requestBody: requestBody.body,
            requestSize: requestBody.size,
            requestBodyTruncated: requestBody.truncated,
            requestBodySkipped: requestBody.bodySkipped || null,
            requestBodyCaptureError: requestBody.captureError || null,
            requestMultipart: requestBody.multipart || null,
            status: response ? response.status() : null,
            responseHeaders,
            responseHeaderCaptureError: responseHeaderError,
            responseContentType: responseHeaders['content-type'] || '',
            responseBody: responseBody.body,
            responseSize: responseBody.size,
            responseBodyTruncated: responseBody.truncated,
            responseBodySkipped: responseBody.bodySkipped || null,
            responseBodyCaptureError: responseBody.captureError || null,
            failure,
            error: failure ? failure.errorText : null,
            url: pageUrl || request.url(),
            frame: frame ? { url: frame.url(), depth: frameDepth } : null,
            context: {
                pageUrl,
                frameUrl: frame ? frame.url() : null,
                frameDepth,
                serviceWorkerUrl: serviceWorker ? serviceWorker.url() : null,
            },
        };
        await options.appendEvents([event]);
    }

    function onFinished(request) {
        void finalize(request, { kind: 'finished' }).catch(error => {
            console.error('[network] finalize finished request failed:', error.message);
        });
    }

    function onFailed(request) {
        void finalize(request, { kind: 'failed', failure: request.failure() || { errorText: 'request failed' } }).catch(error => {
            console.error('[network] finalize failed request failed:', error.message);
        });
    }

    context.on('request', onRequest);
    context.on('requestfinished', onFinished);
    context.on('requestfailed', onFailed);

    return {
        /**
         * 移除本次安装的全部 BrowserContext 网络监听器。
         *
         * @return {void}
         */
        dispose() {
            context.off('request', onRequest);
            context.off('requestfinished', onFinished);
            context.off('requestfailed', onFailed);
        },
    };
}

module.exports = {
    captureBody,
    installNetworkCapture,
    isProbablyText,
    isRecorderRequest,
    parseMultipartMetadata,
    truncateUtf8,
};
