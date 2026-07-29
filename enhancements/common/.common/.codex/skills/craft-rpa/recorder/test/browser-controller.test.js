const assert = require('node:assert/strict');
const test = require('node:test');
const { BrowserController, ControlError, limitText } = require('../browser-controller');

function createLocator(visibleIndexes) {
    return {
        count: async () => 3,
        nth: index => ({
            isVisible: async () => visibleIndexes.includes(index),
            evaluate: async () => ({ tag: 'button', id: `button-${index}`, role: 'button', name: `按钮 ${index}` }),
        }),
    };
}

function createPage(locator) {
    const frame = {
        url: () => 'https://example.test/frame',
        name: () => 'main',
        getByText: () => locator,
    };
    return {
        frames: () => [frame],
        mainFrame: () => frame,
    };
}

test('可见文本按 UTF-8 字节边界截断', () => {
    const result = limitText('你你你你', 10);
    assert.equal(result.value, '你你你');
    assert.equal(result.size, 12);
    assert.equal(result.truncated, true);
});

test('未指定 nth 的多可见匹配返回 AMBIGUOUS_TARGET', async () => {
    const controller = new BrowserController({ getContext: () => null, sessionDir: '/tmp' });
    await assert.rejects(
        controller.resolveTarget(createPage(createLocator([0, 2])), { target: { text: '提交', exact: true } }),
        error => error instanceof ControlError && error.code === 'AMBIGUOUS_TARGET' && error.details.count === 2,
    );
});

test('显式 nth 可以选择调用方接受的可见匹配', async () => {
    const controller = new BrowserController({ getContext: () => null, sessionDir: '/tmp' });
    const result = await controller.resolveTarget(createPage(createLocator([0, 2])), {
        target: { text: '提交', exact: true, nth: 2 },
    });
    assert.equal(result.summary.id, 'button-2');
    assert.equal(result.frame.index, 0);
});

test('target 同时提供两种主定位策略时拒绝执行', async () => {
    const controller = new BrowserController({ getContext: () => null, sessionDir: '/tmp' });
    await assert.rejects(
        controller.resolveTarget(createPage(createLocator([0])), { target: { text: '提交', selector: '#submit' } }),
        error => error instanceof ControlError && error.code === 'INVALID_TARGET',
    );
});

test('禁用元素在动作前返回 TARGET_NOT_ACTIONABLE', async () => {
    const controller = new BrowserController({ getContext: () => null, sessionDir: '/tmp' });
    await assert.rejects(
        controller.ensureTargetActionable({ isEnabled: async () => false }, 'click'),
        error => error instanceof ControlError && error.code === 'TARGET_NOT_ACTIONABLE' && error.statusCode === 409,
    );
});

test('observe 对不响应的 frame 应用整体超时', async () => {
    const frame = {
        parentFrame: () => null,
        url: () => 'https://example.test/',
        name: () => '',
        locator: selector => selector === 'body'
            ? {
                innerText: async () => '',
                ariaSnapshot: async () => '',
            }
            : { evaluateAll: async () => new Promise(() => {}) },
    };
    const page = {
        frames: () => [frame],
        mainFrame: () => frame,
        url: () => 'https://example.test/',
    };
    const context = { pages: () => [page] };
    const controller = new BrowserController({ getContext: () => context, sessionDir: '/tmp' });
    await assert.rejects(
        controller.observe({ timeoutMs: 100, includeText: false, includeAria: false }),
        error => error instanceof ControlError && error.code === 'OBSERVE_TIMEOUT' && error.statusCode === 408,
    );
});
