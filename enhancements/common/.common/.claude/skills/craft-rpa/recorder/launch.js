/**
 * 一键启动器：日志服务 + 持久化 profile 的 Chrome + 自动注入监听脚本
 *
 * 内部直接 require 了 logger.js 并启动它，所以一条命令就能起完整套环境，
 * 不再需要"另开终端跑 logger.js"。
 *
 * 用 Playwright 的 launchPersistentContext 启动一个带独立用户数据目录的浏览器实例，
 * 通过 addInitScript 让 inject.js 在每个页面加载前自动执行——
 * 跳转、新标签页、iframe 全部自动覆盖，无需任何手动重注入。
 *
 * 使用方式：
 *   node launch.js                           # 打开空白页，自己输 URL
 *   node launch.js https://target.com        # 直接打开指定起始网址
 *
 * 前置条件（一次性）：
 *   1. 安装依赖：npm install
 *   2. 浏览器：默认用系统已装 Chrome（USE_SYSTEM_CHROME=true）
 *      没有系统 Chrome 时改成 false，并执行 npx playwright install chromium
 *
 * 数据存放：
 *   - profile/        : 用户数据目录（cookie / localStorage / 登录态等），下次启动自动复用
 *   - session.jsonl   : 事件日志（由内置 logger 写入）
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { startLogger } = require('./logger');

// 启动参数：第一个 CLI 参数作为起始 URL，没传就开空白页
const START_URL = process.argv[2] || 'about:blank';

// profile 目录放在脚本同级 ./profile/，与日常 Chrome 完全隔离
const PROFILE_DIR = path.join(__dirname, 'profile');

// 注入脚本路径
const INJECT_SCRIPT = path.join(__dirname, 'inject.js');

// 是否使用系统 Chrome
// 在 Windows / macOS 上跑：true（用真实系统 Chrome，更真实的 UA、扩展、字体）
// 在 WSL2 Linux / Docker 容器里跑：false（用 Playwright 内置 Chromium，避免找不到 Chrome）
const USE_SYSTEM_CHROME = true;

// 前置检查：inject.js 必须存在，避免起完浏览器才发现没注入
if (!fs.existsSync(INJECT_SCRIPT)) {
    console.error(`[launch] inject.js not found: ${INJECT_SCRIPT}`);
    process.exit(1);
}

(async () => {
    // BrowserContext 引用，先声明，后续 launchPersistentContext 完成后赋值
    // 通过闭包供 browserController 使用，从而让 Dashboard 能控制浏览器
    let ctx = null;

    /**
     * 浏览器控制器：暴露给 Dashboard 调用的一组操作
     *
     * 所有方法都包装成 async，错误会被 logger 的 handleControl 捕获并返回 500。
     * 方法签名约定见 logger.js handleControl 函数。
     */
    const browserController = {
        /**
         * 打开 URL（默认在当前最后一个 tab，可选新开 tab）
         * @param {string} url
         * @param {{newTab?: boolean}} opts
         */
        async open(url, opts = {}) {
            if (!ctx) throw new Error('browser not ready yet');
            const pages = ctx.pages();
            const page = opts.newTab || pages.length === 0 ? await ctx.newPage() : pages[pages.length - 1];
            if (url && url !== 'about:blank') {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
            await page.bringToFront().catch(() => {});
            return { ok: true, url: page.url(), index: ctx.pages().indexOf(page) };
        },

        /**
         * 列出所有打开的 tab
         * @return {Array<{index:number, url:string, title:string}>}
         */
        async listPages() {
            if (!ctx) return [];
            const pages = ctx.pages();
            return Promise.all(pages.map(async (p, i) => ({
                index: i,
                url: p.url(),
                title: await p.title().catch(() => ''),
            })));
        },

        /**
         * 关闭指定 tab
         * @param {number} index tab 序号
         */
        async close(index) {
            if (!ctx) throw new Error('browser not ready');
            const pages = ctx.pages();
            if (!pages[index]) throw new Error('no such page: ' + index);
            await pages[index].close();
            return { ok: true };
        },

        /**
         * 把指定 tab 提到最前
         * @param {number} index tab 序号
         */
        async focus(index) {
            if (!ctx) throw new Error('browser not ready');
            const pages = ctx.pages();
            if (!pages[index]) throw new Error('no such page: ' + index);
            await pages[index].bringToFront();
            return { ok: true };
        },

        /**
         * 刷新指定 tab（不传则刷新第一个）
         * @param {number} [index]
         */
        async reload(index = 0) {
            if (!ctx) throw new Error('browser not ready');
            const p = ctx.pages()[index];
            if (!p) throw new Error('no such page: ' + index);
            await p.reload({ waitUntil: 'domcontentloaded' });
            return { ok: true, url: p.url() };
        },

        /**
         * 浏览器后退
         * @param {number} [index]
         */
        async back(index = 0) {
            if (!ctx) throw new Error('browser not ready');
            const p = ctx.pages()[index];
            if (!p) throw new Error('no such page: ' + index);
            await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
            return { ok: true, url: p.url() };
        },

        /**
         * 浏览器前进
         * @param {number} [index]
         */
        async forward(index = 0) {
            if (!ctx) throw new Error('browser not ready');
            const p = ctx.pages()[index];
            if (!p) throw new Error('no such page: ' + index);
            await p.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
            return { ok: true, url: p.url() };
        },

        /**
         * 在指定 tab 跳转到新 URL
         * @param {number} index
         * @param {string} url
         */
        async navigate(index, url) {
            if (!ctx) throw new Error('browser not ready');
            const p = ctx.pages()[index];
            if (!p) throw new Error('no such page: ' + index);
            await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            return { ok: true, url: p.url() };
        },
    };

    // 先启动日志 + 控制服务，再启动浏览器
    // 浏览器一打开页面，注入脚本立刻就能 POST 成功，不会丢首批事件
    const loggerServer = startLogger({ browserController });

    console.log(`[launch] profile dir : ${PROFILE_DIR}`);
    console.log(`[launch] start url   : ${START_URL}`);
    console.log(`[launch] browser     : ${USE_SYSTEM_CHROME ? 'system chrome' : 'bundled chromium'}`);

    // 启动浏览器（带持久化 profile）
    const launchOptions = {
        headless: false,
        viewport: null,                  // 用窗口实际大小，不强制 1280x720
        args: ['--start-maximized'],     // 启动即最大化
        ignoreHTTPSErrors: true,         // 忽略证书错误，方便内网/自签场景
        // 关键：禁用页面 CSP 检查
        // 目标站点（如 oracle.com）通常设置了严格的 connect-src，
        // 会拦截注入脚本向 http://localhost:7777 的 fetch，导致一条事件都发不出来
        bypassCSP: true,
    };
    if (USE_SYSTEM_CHROME) {
        launchOptions.channel = 'chrome';
    }
    const context = await chromium.launchPersistentContext(PROFILE_DIR, launchOptions);
    ctx = context;  // 绑定到上面 browserController 引用的闭包变量

    // 核心：每个页面加载前自动注入 inject.js
    // 含：首次打开、整页跳转、新标签页、iframe、history.back/forward 后的页面
    await context.addInitScript({ path: INJECT_SCRIPT });

    /**
     * 给一个 page 挂上调试/导航监听器
     * 抽成函数因为已存在的初始 page 和后续 context.on('page') 创建的新 page 都要挂
     * @param {import('playwright').Page} page
     */
    function attachPageListeners(page) {
        page.on('console', msg => {
            // 浏览器端 console.* 转发到终端，便于排查 inject.js 是否执行 / 是否报错
            console.log(`[browser:${msg.type()}] ${msg.text()}`);
        });
        page.on('pageerror', err => {
            console.log(`[browser:pageerror] ${err.message}`);
        });
        page.on('framenavigated', frame => {
            // 仅记录主框架导航，避免 iframe 噪音
            if (frame === page.mainFrame()) {
                console.log(`[launch] navigated : ${frame.url()}`);
            }
        });
    }

    // 新创建的 page（target=_blank / window.open）自动挂监听
    context.on('page', page => {
        console.log(`[launch] new page  : ${page.url() || '(blank)'}`);
        attachPageListeners(page);
    });

    // 浏览器窗口被用户关掉时，连同 logger 一起结束
    context.on('close', () => {
        console.log('[launch] browser closed, shutting down logger');
        loggerServer.close();
        process.exit(0);
    });

    // Ctrl+C 优雅退出，确保 profile 写入磁盘 + logger 正常关闭
    process.on('SIGINT', async () => {
        console.log('\n[launch] SIGINT received, closing browser & logger...');
        try {
            await context.close();
        } catch (e) {
            // 浏览器可能已关闭，忽略
        }
        loggerServer.close();
        process.exit(0);
    });

    // 打开起始页：复用已有的初始 about:blank 标签，避免开两个窗口
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    // 给初始 page 也挂上监听（context.on('page') 不会对已存在的 page 触发）
    attachPageListeners(page);
    if (START_URL !== 'about:blank') {
        try {
            await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err) {
            console.warn(`[launch] initial goto failed: ${err.message}（可在浏览器里手动输地址）`);
        }
    }

    console.log('[launch] ready, operate in the opened browser window');
    console.log('[launch] Ctrl+C in this terminal to stop, or just close the browser window');
})();
