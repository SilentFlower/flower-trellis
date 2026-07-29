#!/usr/bin/env node
const http = require('http');
const https = require('https');
const path = require('path');
const { getLoggerOrigin } = require(path.join(__dirname, '..', 'recorder', 'config'));

/**
 * 调用本地 browser control API。
 *
 * @param {string} action 控制动作。
 * @param {Object} [payload] 动作参数。
 * @param {Object} [options] 客户端配置。
 * @param {string} [options.origin] logger origin。
 * @param {number} [options.timeoutMs] 请求超时。
 * @return {Promise<Object|Array<Object>>} 结构化响应。
 */
function callControl(action, payload = {}, options = {}) {
    const endpoint = new URL(`/control/${encodeURIComponent(action)}`, options.origin || getLoggerOrigin());
    const body = JSON.stringify(payload);
    const transport = endpoint.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = transport.request(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout: options.timeoutMs || 125000,
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsed;
                try {
                    parsed = raw ? JSON.parse(raw) : {};
                } catch (error) {
                    reject(new Error(`control returned invalid JSON: ${raw.slice(0, 500)}`));
                    return;
                }
                if (response.statusCode >= 400) {
                    const detail = parsed.error || {};
                    const failure = new Error(detail.message || `control failed with HTTP ${response.statusCode}`);
                    failure.code = detail.code || 'CONTROL_FAILED';
                    failure.details = detail.details || null;
                    failure.statusCode = response.statusCode;
                    failure.response = parsed;
                    reject(failure);
                    return;
                }
                resolve(parsed);
            });
        });
        request.on('timeout', () => request.destroy(new Error('control request timed out')));
        request.on('error', reject);
        request.end(body);
    });
}

/**
 * 解析 CLI 参数并输出 JSON 结果。
 *
 * @param {string[]} argv 命令行参数。
 * @return {Promise<void>} 执行完成。
 */
async function main(argv) {
    const action = argv[0];
    if (!action) throw new Error('usage: control-client.js <action> [JSON]');
    let payload = {};
    if (argv[1]) {
        try {
            payload = JSON.parse(argv[1]);
        } catch (error) {
            throw new Error(`invalid JSON payload: ${error.message}`);
        }
    }
    const result = await callControl(action, payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        const payload = {
            error: {
                code: error.code || 'CLIENT_FAILED',
                message: error.message,
                details: error.details || null,
            },
        };
        process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
        process.exit(1);
    });
}

module.exports = { callControl, main };
