const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('trace 同时兼容旧网络事件并展示新字段与 body 反查', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-rpa-trace-'));
    const jsonl = path.join(dir, 'session.jsonl');
    const events = [
        {
            kind: 'network', type: 'fetch', method: 'GET', requestUrl: 'https://example.test/old', status: 200,
            clientTime: '2026-01-01T00:00:00.000Z', serverTime: '2026-01-01T00:00:00.100Z',
        },
        {
            kind: 'network', type: 'xhr', source: 'playwright', requestId: 'net-2', method: 'POST',
            requestUrl: 'https://example.test/new', status: 500, requestHeaders: { authorization: 'Bearer raw' },
            requestContentType: 'application/json', requestBody: JSON.stringify({ value: '你'.repeat(1000) }),
            requestSize: 3012, requestBodyTruncated: false, responseHeaders: { 'content-type': 'text/plain' },
            responseContentType: 'text/plain', responseBody: 'failed\n```\nkept', responseSize: 15,
            failure: null, context: { pageUrl: 'https://example.test/form', frameDepth: 0 },
            clientTime: '2026-01-01T00:00:01.000Z', serverTime: '2026-01-01T00:00:01.100Z',
        },
    ];
    fs.writeFileSync(jsonl, `${events.map(event => JSON.stringify(event)).join('\n')}\n`);
    const script = path.join(__dirname, '..', '..', 'scripts', 'jsonl-to-trace.js');
    const output = execFileSync(process.execPath, [script, '--max-body-bytes', '1024', jsonl], { encoding: 'utf8' });
    assert.match(output, /GET .*old/);
    assert.match(output, /requestHeaders/);
    assert.match(output, /Bearer raw/);
    assert.match(output, /trace 展示截断/);
    assert.match(output, /jsonl#2 字段 `\.requestBody`/);
    assert.match(output, /frameDepth/);
    assert.match(output, /````text\n  failed\n  ```\n  kept\n  ````/);
});
