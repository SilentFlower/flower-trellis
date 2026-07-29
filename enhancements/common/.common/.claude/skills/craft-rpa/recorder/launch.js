/**
 * 一键启动日志服务、持久化浏览器、网络采集和页面控制。
 */
const fs = require('fs');
const path = require('path');
const PLAYWRIGHT_MODULE = process.env.CRAFT_RPA_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(PLAYWRIGHT_MODULE);
const { createBrowserController } = require('./browser-controller');
const {
    MAX_FALLBACK_PAYLOAD_BYTES,
    MAX_NETWORK_BODY_BYTES,
    getLoggerOrigin,
    resolvePort,
} = require('./config');
const { startLogger } = require('./logger');
const { installNetworkCapture } = require('./network-capture');

const START_URL = process.argv[2] || 'about:blank';
const PROFILE_DIR = path.resolve(process.env.CRAFT_RPA_PROFILE_DIR || path.join(__dirname, 'profile'));
const SESSION_LOG = path.resolve(process.env.CRAFT_RPA_SESSION_FILE || path.join(__dirname, 'session.jsonl'));
const INJECT_SCRIPT = path.join(__dirname, 'inject.js');
const PORT = resolvePort();
const USE_SYSTEM_CHROME = process.env.CRAFT_RPA_USE_SYSTEM_CHROME !== 'false';
const HEADLESS = process.env.CRAFT_RPA_HEADLESS === 'true';

if (!fs.existsSync(INJECT_SCRIPT)) {
    console.error(`[launch] inject.js not found: ${INJECT_SCRIPT}`);
    process.exit(1);
}

/**
 * 获取当前会话目录，优先使用 run.sh 传入值。
 *
 * @return {string} 会话目录绝对路径。
 */
function resolveSessionDir() {
    if (process.env.CRAFT_RPA_SESSION_DIR) return path.resolve(process.env.CRAFT_RPA_SESSION_DIR);
    try {
        return path.dirname(fs.realpathSync(SESSION_LOG));
    } catch (error) {
        return path.dirname(SESSION_LOG);
    }
}

/**
 * 给页面挂调试和主 frame 导航监听。
 *
 * @param {import('playwright').Page} page Playwright 页面。
 * @return {void}
 */
function attachPageListeners(page) {
    page.on('console', message => console.log(`[browser:${message.type()}] ${message.text()}`));
    page.on('pageerror', error => console.log(`[browser:pageerror] ${error.message}`));
    page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) console.log(`[launch] navigated : ${frame.url()}`);
    });
}

(async () => {
    let context = null;
    let shuttingDown = false;
    const sessionDir = resolveSessionDir();
    const controller = createBrowserController({ getContext: () => context, sessionDir });
    const loggerServer = startLogger({ port: PORT, logFile: SESSION_LOG, browserController: controller });

    console.log(`[launch] profile dir : ${PROFILE_DIR}`);
    console.log(`[launch] session dir : ${sessionDir}`);
    console.log(`[launch] start url   : ${START_URL}`);
    console.log(`[launch] browser     : ${USE_SYSTEM_CHROME ? 'system chrome' : 'bundled chromium'}`);

    const launchOptions = {
        headless: HEADLESS,
        viewport: HEADLESS ? { width: 1440, height: 1000 } : null,
        args: HEADLESS ? [] : ['--start-maximized'],
        ignoreHTTPSErrors: true,
    };
    if (USE_SYSTEM_CHROME) launchOptions.channel = 'chrome';
    context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);

    await context.exposeBinding('__craftRpaAppendEvents', async (source, payload) => {
        const events = Array.isArray(payload) ? payload : [payload];
        loggerServer.appendEvents(events);
        return { ok: true, count: events.length };
    });
    const injectContent = fs.readFileSync(INJECT_SCRIPT, 'utf8');
    await context.addInitScript({
        content: `globalThis.__CRAFT_RPA_CONFIG__ = ${JSON.stringify({
            loggerUrl: `${getLoggerOrigin({ port: PORT })}/log`,
            maxFallbackPayloadBytes: MAX_FALLBACK_PAYLOAD_BYTES,
        })};\n${injectContent}`,
    });
    const networkCapture = installNetworkCapture(context, {
        appendEvents: events => loggerServer.appendEvents(events),
        port: PORT,
        maxBodyBytes: MAX_NETWORK_BODY_BYTES,
    });

    context.on('page', page => {
        console.log(`[launch] new page  : ${page.url() || '(blank)'}`);
        attachPageListeners(page);
    });

    /**
     * 关闭网络监听、浏览器和 logger，避免 profile 或 JSONL 半写入。
     *
     * @param {string} reason 退出原因。
     * @return {Promise<void>} 关闭完成。
     */
    async function shutdown(reason) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[launch] ${reason}, shutting down...`);
        networkCapture.dispose();
        try { await context.close(); } catch (error) { /* 浏览器可能已关闭。 */ }
        await new Promise(resolve => loggerServer.close(resolve));
    }

    context.on('close', () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('[launch] browser closed, shutting down logger');
        loggerServer.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
        void shutdown('SIGINT received').then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
        void shutdown('SIGTERM received').then(() => process.exit(0));
    });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    attachPageListeners(page);
    if (START_URL !== 'about:blank') {
        try {
            await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (error) {
            console.warn(`[launch] initial goto failed: ${error.message}（可通过 control 或浏览器地址栏继续）`);
        }
    }

    console.log('[launch] ready, browser can be operated by user, Dashboard, or run.sh control');
})().catch(error => {
    console.error('[launch] fatal:', error.stack || error.message);
    process.exit(1);
});
