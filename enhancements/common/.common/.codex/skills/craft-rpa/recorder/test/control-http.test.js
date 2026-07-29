const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { callControl } = require('../../scripts/control-client');
const { startLogger } = require('../logger');

function findFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function request(url, options = {}, payload = null) {
    return new Promise((resolve, reject) => {
        const body = payload === null ? null : (Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload)));
        const req = http.request(url, {
            method: options.method || 'GET',
            headers: {
                ...(options.headers || {}),
                ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
            },
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end(body || undefined);
    });
}

test('无 token 的本机客户端可控制，第三方 Origin 被拒绝，跨域 /log 保持可用', async t => {
    const port = await findFreePort();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-rpa-logger-'));
    const logFile = path.join(dir, 'session.jsonl');
    const controller = {
        dispatch: async (action, body) => ({ ok: true, action, body }),
    };
    const server = startLogger({ port, host: '127.0.0.1', logFile, browserController: controller });
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${port}`;

    const cliResult = await callControl('click', { target: { testId: 'submit' } }, { origin });
    assert.equal(cliResult.ok, true);
    assert.equal(cliResult.action, 'click');

    const forbidden = await request(`${origin}/control/click`, {
        method: 'POST',
        headers: { Origin: 'https://third-party.example' },
    }, { target: { testId: 'submit' } });
    assert.equal(forbidden.status, 403);
    assert.equal(JSON.parse(forbidden.body).error.code, 'ORIGIN_FORBIDDEN');

    const logged = await request(`${origin}/log`, {
        method: 'POST',
        headers: { Origin: 'https://third-party.example' },
    }, { kind: 'interaction', type: 'click' });
    assert.equal(logged.status, 200);
    const event = JSON.parse(fs.readFileSync(logFile, 'utf8').trim());
    assert.equal(event.kind, 'interaction');
    assert.ok(event.serverTime);

    server.appendEvents({
        kind: 'network',
        requestUrl: 'https://example.test/private',
        requestHeaders: { authorization: 'Bearer local' },
        requestBody: 'raw-request-body',
        requestSize: 16,
        responseHeaders: { 'set-cookie': 'session=raw-secret' },
        responseBody: 'raw-response-body',
        responseSize: 17,
    });
    const summaries = JSON.parse((await request(`${origin}/events`)).body);
    const networkSummary = summaries.find(item => item.kind === 'network');
    assert.equal(networkSummary.requestBody, undefined);
    assert.equal(networkSummary.responseBody, undefined);
    assert.equal(networkSummary.requestHeaders, undefined);
    assert.equal(networkSummary.responseHeaders, undefined);
    assert.equal(networkSummary.requestBodyCaptured, true);
    assert.equal(networkSummary.responseBodyCaptured, true);

    const session = await request(`${origin}/session`);
    assert.equal(session.status, 200);
    assert.match(session.body, /raw-request-body/);
    assert.match(session.body, /Bearer local/);

    const tooLarge = await request(`${origin}/control/click`, { method: 'POST' }, Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
    assert.equal(tooLarge.status, 413);
    assert.equal(JSON.parse(tooLarge.body).error.code, 'BODY_TOO_LARGE');
});
