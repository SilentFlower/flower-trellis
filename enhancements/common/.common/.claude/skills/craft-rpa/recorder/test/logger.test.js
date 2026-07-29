const assert = require('node:assert/strict');
const test = require('node:test');
const { isProtectedOriginAllowed } = require('../logger');

test('无 Origin 的本机客户端和同源 Dashboard 可访问控制接口', () => {
    assert.equal(isProtectedOriginAllowed(undefined, 'localhost:7777'), true);
    assert.equal(isProtectedOriginAllowed('http://localhost:7777', 'localhost:7777'), true);
    assert.equal(isProtectedOriginAllowed('http://127.0.0.1:3000', 'localhost:7777'), true);
});

test('第三方页面 Origin 不能调用控制接口', () => {
    assert.equal(isProtectedOriginAllowed('https://example.test', 'localhost:7777'), false);
    assert.equal(isProtectedOriginAllowed('invalid-origin', 'localhost:7777'), false);
});
