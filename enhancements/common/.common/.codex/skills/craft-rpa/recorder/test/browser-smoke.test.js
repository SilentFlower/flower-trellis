const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBrowserController } = require('../browser-controller');
const { installNetworkCapture } = require('../network-capture');

let chromium = null;
try {
    ({ chromium } = require('playwright'));
} catch (error) {
    // 普通单测不要求预装运行时依赖；显式 smoke 会在依赖可用时执行。
}

function listen(server) {
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
    return new Promise(resolve => server.close(resolve));
}

test('真实浏览器可感知页面、操作元素并采集跨 frame Fetch/XHR', {
    skip: process.env.CRAFT_RPA_BROWSER_SMOKE !== '1'
        ? '未启用 CRAFT_RPA_BROWSER_SMOKE'
        : chromium === null ? 'Playwright 运行时依赖不可用' : false,
    timeout: 60000,
}, async t => {
    const events = [];
    const frameServer = http.createServer((req, res) => {
        if (req.url === '/frame') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><button id="frame-button">Frame button</button><script>
                fetch('/frame-api').catch(() => {});
                const xhr = new XMLHttpRequest(); xhr.open('GET', '/frame-xhr'); xhr.send();
            </script>`);
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: req.url, source: 'frame' }));
    });
    const framePort = await listen(frameServer);
    t.after(() => close(frameServer));

    const mainServer = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html>
                <label for="name">姓名</label><input id="name">
                <label for="agree">同意</label><input id="agree" type="checkbox">
                <label for="region">地区</label><select id="region"><option value="cn">中国</option><option value="sg">新加坡</option></select>
                <button data-testid="submit">提交</button>
                <input type="submit" value="原生提交">
                <output id="result"></output>
                <iframe src="http://127.0.0.1:${framePort}/frame"></iframe>
                <script>
                    document.querySelector('[data-testid="submit"]').addEventListener('click', async () => {
                        const response = await fetch('/submit', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: document.querySelector('#name').value }),
                        });
                        document.querySelector('#result').textContent = await response.text();
                    });
                    document.querySelector('input[type="submit"]').addEventListener('click', event => {
                        event.preventDefault();
                        document.querySelector('#result').dataset.nativeClicked = 'yes';
                    });
                </script>`);
            return;
        }
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Smoke': 'yes' });
            res.end(JSON.stringify({ ok: true, requestBody: Buffer.concat(chunks).toString('utf8') }));
        });
    });
    const mainPort = await listen(mainServer);
    t.after(() => close(mainServer));

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext();
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-rpa-smoke-'));
    const controller = createBrowserController({ getContext: () => context, sessionDir });
    await context.exposeBinding('__craftRpaAppendEvents', (source, payload) => {
        events.push(...(Array.isArray(payload) ? payload : [payload]));
        return { ok: true };
    });
    const injectContent = fs.readFileSync(path.join(__dirname, '..', 'inject.js'), 'utf8');
    await context.addInitScript({ content: `globalThis.__CRAFT_RPA_CONFIG__ = {};\n${injectContent}` });
    const capture = installNetworkCapture(context, { appendEvents: batch => events.push(...batch), port: 7777, maxBodyBytes: 20 * 1024 * 1024 });
    t.after(() => capture.dispose());

    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${mainPort}/`, { waitUntil: 'networkidle' });
    const observed = await controller.observe({ index: 0, screenshot: true, dom: true });
    assert.equal(observed.frames.length, 2);
    assert.equal(fs.existsSync(observed.artifacts.screenshot.path), true);
    assert.equal(observed.artifacts.dom.length, 2);
    const nativeSubmit = observed.frames[0].elements.find(element => element.name === '原生提交');
    assert.deepEqual(nativeSubmit.target, { role: 'button', name: '原生提交', exact: true });
    await controller.dispatch('click', { index: 0, target: nativeSubmit.target });
    assert.equal(await page.locator('#result').getAttribute('data-native-clicked'), 'yes');

    await controller.dispatch('fill', { index: 0, target: { label: '姓名', exact: true }, value: '静默花' });
    await controller.dispatch('select', { index: 0, target: { label: '地区', exact: true }, value: 'sg' });
    await controller.dispatch('check', { index: 0, target: { label: '同意', exact: true } });
    await controller.dispatch('click', { index: 0, target: { testId: 'submit' } });
    await page.waitForFunction(() => document.querySelector('#result').textContent.includes('requestBody'));
    await page.waitForTimeout(700);

    const networkEvents = events.filter(event => event.kind === 'network');
    assert.equal(networkEvents.some(event => event.requestUrl.includes('/submit') && event.requestBody.includes('静默花')), true);
    assert.equal(networkEvents.some(event => event.requestUrl.includes('/frame-api')), true);
    assert.equal(networkEvents.some(event => event.requestUrl.includes('/frame-xhr')), true);
    assert.equal(events.some(event => event.kind === 'interaction' && event.type === 'click'), true);
});
