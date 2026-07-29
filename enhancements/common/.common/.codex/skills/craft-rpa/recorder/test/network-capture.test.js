const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { MAX_NETWORK_BODY_BYTES } = require('../config');
const {
    captureBody,
    installNetworkCapture,
    isRecorderRequest,
    parseMultipartMetadata,
    truncateUtf8,
} = require('../network-capture');

class FakeContext extends EventEmitter {}

function createFrame(url = 'https://example.test/page') {
    return {
        url: () => url,
        name: () => '',
        parentFrame: () => null,
        page: () => ({ url: () => url }),
    };
}

function createResponse(options = {}) {
    return {
        status: () => options.status ?? 200,
        allHeaders: async () => options.headers || { 'content-type': 'application/json' },
        body: async () => {
            if (options.onBody) options.onBody();
            return Buffer.from(options.body ?? '{"ok":true}');
        },
    };
}

function createRequest(options = {}) {
    const response = options.response === undefined ? createResponse() : options.response;
    return {
        resourceType: () => options.resourceType || 'fetch',
        url: () => options.url || 'https://api.example.test/items',
        method: () => options.method || 'POST',
        redirectedFrom: () => options.redirectedFrom || null,
        allHeaders: async () => options.headers || { 'content-type': 'application/json', authorization: 'Bearer raw-token' },
        postDataBuffer: () => Buffer.from(options.body ?? '{"name":"测试"}'),
        response: async () => response,
        frame: () => options.frame || createFrame(),
        serviceWorker: () => options.serviceWorker || null,
        failure: () => options.failure || null,
    };
}

function nextTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

test('默认网络正文捕获上限为单方向 20 MiB', () => {
    assert.equal(MAX_NETWORK_BODY_BYTES, 20 * 1024 * 1024);
});

test('文本正文可完整保存到 20 MiB 并在下一字节截断', () => {
    const input = Buffer.alloc(MAX_NETWORK_BODY_BYTES + 1, 0x61);
    const result = captureBody(input, 'text/plain');
    assert.equal(Buffer.byteLength(result.body), MAX_NETWORK_BODY_BYTES);
    assert.equal(result.size, MAX_NETWORK_BODY_BYTES + 1);
    assert.equal(result.truncated, true);
});

test('UTF-8 截断不切断多字节字符且不超过字节上限', () => {
    const result = truncateUtf8(Buffer.from('你你你你'), 10);
    assert.equal(result.text, '你你你');
    assert.equal(Buffer.byteLength(result.text), 9);
    assert.equal(result.size, 12);
    assert.equal(result.truncated, true);
});

test('异常 UTF-8 字节也不会让替换字符突破上限', () => {
    const result = truncateUtf8(Buffer.from([0xff, 0xff, 0x61]), 3);
    assert.ok(Buffer.byteLength(result.text) <= 3);
    assert.equal(result.text.includes('\ufffd'), true);
});

test('文本正文、二进制正文和无类型响应按契约分类', () => {
    const text = captureBody(Buffer.from('{"ok":true}'), 'application/json', { maxBytes: 20 });
    assert.equal(text.body, '{"ok":true}');
    assert.equal(text.bodySkipped, undefined);

    const binary = captureBody(Buffer.from([0, 1, 2]), 'image/png');
    assert.equal(binary.body, null);
    assert.equal(binary.bodySkipped, 'binary-content-type');

    const unknownResponse = captureBody(Buffer.from('plain'), '', { allowUnknownText: false });
    assert.equal(unknownResponse.body, null);
    assert.equal(unknownResponse.bodySkipped, 'missing-content-type');
});

test('multipart 仅保留普通字段和文件元数据', () => {
    const raw = Buffer.from([
        '--abc',
        'Content-Disposition: form-data; name="title"',
        '',
        'hello',
        '--abc',
        'Content-Disposition: form-data; name="file"; filename="a.txt"',
        'Content-Type: text/plain',
        '',
        'secret-file-body',
        '--abc--',
        '',
    ].join('\r\n'));
    const result = parseMultipartMetadata(raw, 'multipart/form-data; boundary=abc', 1024);
    assert.equal(result.parsed, true);
    assert.deepEqual(result.parts[0], { name: 'title', value: 'hello', size: 5, truncated: false });
    assert.equal(result.parts[1].filename, 'a.txt');
    assert.equal(result.parts[1].fileBodySkipped, true);
    assert.equal(result.parts[1].size, Buffer.byteLength('secret-file-body'));
    assert.equal(result.parts[1].value, undefined);
});

test('multipart boundary 保持大小写', () => {
    const raw = Buffer.from('--AbC\r\nContent-Disposition: form-data; name="v"\r\n\r\nx\r\n--AbC--\r\n');
    const result = captureBody(raw, 'multipart/form-data; boundary=AbC');
    assert.equal(result.bodySkipped, 'multipart-metadata-only');
    assert.equal(result.multipart[0].value, 'x');
});

test('recorder 自身路径只在匹配本机 host 与端口时过滤', () => {
    assert.equal(isRecorderRequest('http://localhost:7777/log', { port: 7777 }), true);
    assert.equal(isRecorderRequest('http://localhost:7777/session', { port: 7777 }), true);
    assert.equal(isRecorderRequest('http://127.0.0.1:7777/control/click', { port: 7777 }), true);
    assert.equal(isRecorderRequest('http://localhost:8888/log', { port: 7777 }), false);
    assert.equal(isRecorderRequest('https://example.test/log', { port: 7777 }), false);
});

test('已知超限响应不调用会整块物化正文的 response.body', async () => {
    const context = new FakeContext();
    const events = [];
    let bodyCalled = false;
    const response = createResponse({
        headers: {
            'content-type': 'text/plain',
            'content-length': String(1025),
        },
        onBody: () => { bodyCalled = true; },
    });
    const request = createRequest({ response });
    installNetworkCapture(context, { appendEvents: batch => events.push(...batch), port: 7777, maxBodyBytes: 1024 });
    context.emit('request', request);
    context.emit('requestfinished', request);
    await nextTurn();

    assert.equal(bodyCalled, false);
    assert.equal(events[0].responseSize, 1025);
    assert.equal(events[0].responseBody, null);
    assert.equal(events[0].responseBodyTruncated, true);
    assert.equal(events[0].responseBodySkipped, 'content-length-exceeds-capture-limit');
});

test('成功请求只 finalize 一次并保存完整请求响应上下文', async () => {
    const context = new FakeContext();
    const events = [];
    installNetworkCapture(context, { appendEvents: batch => events.push(...batch), port: 7777, maxBodyBytes: 1024 });
    const request = createRequest();
    context.emit('request', request);
    context.emit('requestfinished', request);
    context.emit('requestfinished', request);
    await nextTurn();

    assert.equal(events.length, 1);
    assert.equal(events[0].status, 200);
    assert.equal(events[0].requestHeaders.authorization, 'Bearer raw-token');
    assert.equal(events[0].requestBody, '{"name":"测试"}');
    assert.equal(events[0].responseBody, '{"ok":true}');
    assert.equal(events[0].context.frameDepth, 0);
    assert.equal(events[0].failure, null);
});

test('失败请求与 redirect 链保留结构化失败和来源 requestId', async () => {
    const context = new FakeContext();
    const events = [];
    installNetworkCapture(context, { appendEvents: batch => events.push(...batch), port: 7777, maxBodyBytes: 1024 });

    const first = createRequest({ url: 'https://api.example.test/start', response: createResponse({ status: 302, headers: { location: '/next' }, body: '' }) });
    const second = createRequest({ url: 'https://api.example.test/next', redirectedFrom: first });
    const failed = createRequest({ url: 'https://127.0.0.1:1/fail', response: null, failure: { errorText: 'net::ERR_CONNECTION_REFUSED' } });
    context.emit('request', first);
    context.emit('request', second);
    context.emit('request', failed);
    context.emit('requestfinished', first);
    context.emit('requestfinished', second);
    context.emit('requestfailed', failed);
    await nextTurn();

    const firstEvent = events.find(event => event.requestUrl.endsWith('/start'));
    const secondEvent = events.find(event => event.requestUrl.endsWith('/next'));
    const failedEvent = events.find(event => event.requestUrl.includes('/fail'));
    assert.equal(secondEvent.redirectedFromRequestId, firstEvent.requestId);
    assert.equal(failedEvent.status, null);
    assert.equal(failedEvent.failure.errorText, 'net::ERR_CONNECTION_REFUSED');
    assert.equal(failedEvent.error, 'net::ERR_CONNECTION_REFUSED');
});
