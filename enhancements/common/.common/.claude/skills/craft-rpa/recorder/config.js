const DEFAULT_PORT = 7777;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_CLIENT_HOST = 'localhost';
const MAX_NETWORK_BODY_BYTES = 20 * 1024 * 1024;
const MAX_FALLBACK_PAYLOAD_BYTES = 60 * 1024;
const MAX_OBSERVE_TEXT_BYTES = 64 * 1024;
const MAX_OBSERVE_ARIA_BYTES = 64 * 1024;
const MAX_OBSERVE_METADATA_BYTES = 4 * 1024;
const MAX_OBSERVE_DOM_BYTES = 5 * 1024 * 1024;
const MAX_OBSERVE_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_OBSERVE_ELEMENTS = 500;
const MAX_OBSERVE_FRAMES = 100;

/**
 * 解析 recorder 端口，非法值回退到默认端口。
 *
 * @param {string|number|undefined} value 候选端口。
 * @return {number} 可用端口。
 */
function resolvePort(value = process.env.CRAFT_RPA_PORT) {
    const port = Number.parseInt(String(value || ''), 10);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

/**
 * 返回浏览器或本机客户端访问 logger 的 HTTP origin。
 *
 * @param {Object} [options] 配置项。
 * @param {string} [options.host] 客户端访问主机名。
 * @param {number} [options.port] logger 端口。
 * @return {string} HTTP origin。
 */
function getLoggerOrigin(options = {}) {
    const host = options.host || process.env.CRAFT_RPA_CLIENT_HOST || DEFAULT_CLIENT_HOST;
    const port = resolvePort(options.port);
    return `http://${host}:${port}`;
}

module.exports = {
    DEFAULT_PORT,
    DEFAULT_HOST,
    DEFAULT_CLIENT_HOST,
    MAX_NETWORK_BODY_BYTES,
    MAX_FALLBACK_PAYLOAD_BYTES,
    MAX_OBSERVE_TEXT_BYTES,
    MAX_OBSERVE_ARIA_BYTES,
    MAX_OBSERVE_METADATA_BYTES,
    MAX_OBSERVE_DOM_BYTES,
    MAX_OBSERVE_SCREENSHOT_BYTES,
    MAX_OBSERVE_ELEMENTS,
    MAX_OBSERVE_FRAMES,
    resolvePort,
    getLoggerOrigin,
};
