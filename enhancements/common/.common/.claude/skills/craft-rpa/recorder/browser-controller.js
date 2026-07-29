const fs = require('fs');
const path = require('path');
const {
    MAX_OBSERVE_ARIA_BYTES,
    MAX_OBSERVE_DOM_BYTES,
    MAX_OBSERVE_ELEMENTS,
    MAX_OBSERVE_FRAMES,
    MAX_OBSERVE_METADATA_BYTES,
    MAX_OBSERVE_SCREENSHOT_BYTES,
    MAX_OBSERVE_TEXT_BYTES,
} = require('./config');
const { truncateUtf8 } = require('./network-capture');

const TARGET_KEYS = ['selector', 'role', 'text', 'label', 'placeholder', 'testId'];

/**
 * 带稳定错误码和 HTTP 状态的浏览器控制错误。
 */
class ControlError extends Error {
    /**
     * 创建控制错误。
     *
     * @param {string} code 稳定错误码。
     * @param {string} message 人类可读说明。
     * @param {Object|null} [details] 补充信息。
     * @param {number} [statusCode] HTTP 状态码。
     */
    constructor(code, message, details = null, statusCode = 400) {
        super(message);
        this.name = 'ControlError';
        this.code = code;
        this.details = details;
        this.statusCode = statusCode;
    }
}

/**
 * 截取字符串并保留 UTF-8 字节边界。
 *
 * @param {string} value 原始文本。
 * @param {number} maxBytes 最大字节数。
 * @return {{value:string,size:number,truncated:boolean}} 截取结果。
 */
function limitText(value, maxBytes) {
    const captured = truncateUtf8(Buffer.from(String(value || ''), 'utf8'), maxBytes);
    return { value: captured.text, size: captured.size, truncated: captured.truncated };
}

/**
 * 把文件名中的不稳定字符替换为安全字符。
 *
 * @param {string} value 原始文件名片段。
 * @return {string} 安全文件名片段。
 */
function safeFilePart(value) {
    return String(value || 'frame').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'frame';
}

/**
 * 统一封装当前录制浏览器的页面感知和操作能力。
 */
class BrowserController {
    /**
     * 创建浏览器控制器。
     *
     * @param {Object} options 配置项。
     * @param {()=>import('playwright').BrowserContext|null} options.getContext 获取当前 BrowserContext。
     * @param {string} options.sessionDir 当前会话目录。
     */
    constructor(options) {
        this.getContext = options.getContext;
        this.sessionDir = options.sessionDir;
    }

    /**
     * 分派 HTTP control action。
     *
     * @param {string} action 动作名。
     * @param {Object} [body] 动作参数。
     * @return {Promise<Object|Array<Object>>} 结构化执行结果。
     */
    async dispatch(action, body = {}) {
        switch (action) {
            case 'pages': return this.listPages();
            case 'open': return this.open(body.url, body);
            case 'close': return this.close(body.index);
            case 'focus': return this.focus(body.index);
            case 'reload': return this.reload(body.index, body);
            case 'back': return this.back(body.index, body);
            case 'forward': return this.forward(body.index, body);
            case 'navigate': return this.navigate(body.index, body.url, body);
            case 'observe': return this.observe(body);
            case 'click': return this.performElementAction('click', body);
            case 'fill': return this.performElementAction('fill', body);
            case 'type': return this.performElementAction('type', body);
            case 'press': return this.performElementAction('press', body);
            case 'select': return this.performElementAction('select', body);
            case 'check': return this.performElementAction('check', body);
            case 'uncheck': return this.performElementAction('uncheck', body);
            default: throw new ControlError('UNKNOWN_ACTION', `unknown control action: ${action}`, { action }, 404);
        }
    }

    /**
     * 列出当前所有 tab。
     *
     * @return {Promise<Array<{index:number,url:string,title:string}>>} 页面列表。
     */
    async listPages() {
        const context = this.getReadyContext(false);
        if (!context) return [];
        return Promise.all(context.pages().map(async (page, index) => {
            const url = limitText(page.url(), MAX_OBSERVE_METADATA_BYTES);
            const title = limitText(await page.title().catch(() => ''), MAX_OBSERVE_METADATA_BYTES);
            return {
                index,
                url: url.value,
                urlTruncated: url.truncated,
                title: title.value,
                titleTruncated: title.truncated,
            };
        }));
    }

    /**
     * 在当前最后一个 tab 或新 tab 打开 URL。
     *
     * @param {string} url 目标 URL。
     * @param {{newTab?:boolean,timeoutMs?:number}} [options] 打开配置。
     * @return {Promise<Object>} 打开结果。
     */
    async open(url, options = {}) {
        const context = this.getReadyContext();
        const pages = context.pages();
        const page = options.newTab || pages.length === 0 ? await context.newPage() : pages[pages.length - 1];
        if (url && url !== 'about:blank') {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout(options) });
        }
        await page.bringToFront().catch(() => {});
        return { ok: true, action: 'open', url: page.url(), index: context.pages().indexOf(page) };
    }

    /**
     * 关闭指定 tab。
     *
     * @param {number} index tab 序号。
     * @return {Promise<Object>} 关闭结果。
     */
    async close(index) {
        const page = this.getPage(index);
        await page.close();
        return { ok: true, action: 'close', index: Number(index) };
    }

    /**
     * 把指定 tab 提到最前。
     *
     * @param {number} index tab 序号。
     * @return {Promise<Object>} 聚焦结果。
     */
    async focus(index) {
        const page = this.getPage(index);
        await page.bringToFront();
        return { ok: true, action: 'focus', index: Number(index), url: page.url() };
    }

    /**
     * 刷新指定 tab。
     *
     * @param {number} [index] tab 序号。
     * @param {{timeoutMs?:number}} [options] 导航配置。
     * @return {Promise<Object>} 刷新结果。
     */
    async reload(index = 0, options = {}) {
        const page = this.getPage(index);
        try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: this.timeout(options) });
        } catch (error) {
            throw this.navigationError('reload', error, page);
        }
        return { ok: true, action: 'reload', index: Number(index || 0), url: page.url() };
    }

    /**
     * 让指定 tab 后退。
     *
     * @param {number} [index] tab 序号。
     * @param {{timeoutMs?:number}} [options] 导航配置。
     * @return {Promise<Object>} 后退结果。
     */
    async back(index = 0, options = {}) {
        const page = this.getPage(index);
        let response;
        try {
            response = await page.goBack({ waitUntil: 'domcontentloaded', timeout: this.timeout(options) });
        } catch (error) {
            throw this.navigationError('back', error, page);
        }
        return { ok: true, action: 'back', navigated: response !== null, index: Number(index || 0), url: page.url() };
    }

    /**
     * 让指定 tab 前进。
     *
     * @param {number} [index] tab 序号。
     * @param {{timeoutMs?:number}} [options] 导航配置。
     * @return {Promise<Object>} 前进结果。
     */
    async forward(index = 0, options = {}) {
        const page = this.getPage(index);
        let response;
        try {
            response = await page.goForward({ waitUntil: 'domcontentloaded', timeout: this.timeout(options) });
        } catch (error) {
            throw this.navigationError('forward', error, page);
        }
        return { ok: true, action: 'forward', navigated: response !== null, index: Number(index || 0), url: page.url() };
    }

    /**
     * 在指定 tab 跳转 URL。
     *
     * @param {number} index tab 序号。
     * @param {string} url 目标 URL。
     * @param {{timeoutMs?:number}} [options] 导航配置。
     * @return {Promise<Object>} 跳转结果。
     */
    async navigate(index, url, options = {}) {
        if (!url) throw new ControlError('INVALID_ARGUMENT', 'navigate requires url');
        const page = this.getPage(index);
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout(options) });
        } catch (error) {
            throw this.navigationError('navigate', error, page);
        }
        return { ok: true, action: 'navigate', index: Number(index || 0), url: page.url() };
    }

    /**
     * 获取页面、frame、文本、ARIA、交互元素及可选文件型快照。
     *
     * @param {Object} [options] 感知配置。
     * @return {Promise<Object>} 有界页面状态。
     */
    async observe(options = {}) {
        const page = this.getPage(options.index);
        const frames = page.frames();
        const observedFrames = frames.slice(0, MAX_OBSERVE_FRAMES);
        const includeText = options.includeText !== false;
        const includeAria = options.includeAria !== false;
        const includeElements = options.includeElements !== false;
        const frameResults = [];
        const deadline = Date.now() + this.timeout(options);
        let remainingElements = MAX_OBSERVE_ELEMENTS;

        for (let index = 0; index < observedFrames.length; index += 1) {
            this.ensureObserveTime(deadline);
            const frame = observedFrames[index];
            const parent = frame.parentFrame();
            const frameUrl = limitText(frame.url(), MAX_OBSERVE_METADATA_BYTES);
            const frameName = limitText(frame.name(), MAX_OBSERVE_METADATA_BYTES);
            const result = {
                index,
                url: frameUrl.value,
                urlTruncated: frameUrl.truncated,
                name: frameName.value,
                nameTruncated: frameName.truncated,
                parentIndex: parent ? frames.indexOf(parent) : null,
            };
            if (includeText) {
                try {
                    const text = await frame.locator('body').innerText({ timeout: this.observeStepTimeout(deadline) });
                    const limited = limitText(text, MAX_OBSERVE_TEXT_BYTES);
                    result.text = limited.value;
                    result.textSize = limited.size;
                    result.textTruncated = limited.truncated;
                } catch (error) {
                    this.ensureObserveTime(deadline);
                    result.textError = limitText(error.message, MAX_OBSERVE_METADATA_BYTES).value;
                }
            }
            if (includeAria) {
                try {
                    const aria = await frame.locator('body').ariaSnapshot({ timeout: this.observeStepTimeout(deadline) });
                    const limited = limitText(aria, MAX_OBSERVE_ARIA_BYTES);
                    result.aria = limited.value;
                    result.ariaSize = limited.size;
                    result.ariaTruncated = limited.truncated;
                } catch (error) {
                    this.ensureObserveTime(deadline);
                    result.ariaError = limitText(error.message, MAX_OBSERVE_METADATA_BYTES).value;
                }
            }
            if (includeElements && remainingElements > 0) {
                try {
                    const elements = await this.withObserveDeadline(
                        this.collectInteractiveElements(frame, remainingElements),
                        deadline,
                    );
                    result.elements = elements;
                    remainingElements -= elements.length;
                } catch (error) {
                    this.ensureObserveTime(deadline);
                    result.elementsError = limitText(error.message, MAX_OBSERVE_METADATA_BYTES).value;
                }
            }
            frameResults.push(result);
        }

        const artifacts = {};
        if (options.screenshot || options.dom) {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const dir = path.join(this.sessionDir, 'artifacts', `observe-${stamp}`);
            fs.mkdirSync(dir, { recursive: true });
            if (options.screenshot) {
                const screenshotPath = path.join(dir, 'page.png');
                await this.withObserveDeadline(page.screenshot({
                    path: screenshotPath,
                    fullPage: Boolean(options.fullPage),
                    timeout: this.observeStepTimeout(deadline),
                }), deadline);
                const screenshotSize = fs.statSync(screenshotPath).size;
                if (screenshotSize > MAX_OBSERVE_SCREENSHOT_BYTES) {
                    fs.rmSync(screenshotPath, { force: true });
                    artifacts.screenshot = {
                        error: 'screenshot exceeded artifact size limit',
                        size: screenshotSize,
                        limit: MAX_OBSERVE_SCREENSHOT_BYTES,
                    };
                } else {
                    artifacts.screenshot = { path: screenshotPath, size: screenshotSize };
                }
            }
            if (options.dom) {
                artifacts.dom = [];
                for (let index = 0; index < observedFrames.length; index += 1) {
                    const frame = observedFrames[index];
                    try {
                        const html = await this.withObserveDeadline(frame.content(), deadline);
                        const limited = limitText(html, MAX_OBSERVE_DOM_BYTES);
                        const file = path.join(dir, `frame-${index}-${safeFilePart(frame.name() || 'main')}.html`);
                        fs.writeFileSync(file, limited.value);
                        artifacts.dom.push({
                            frameIndex: index,
                            path: file,
                            size: limited.size,
                            storedSize: Buffer.byteLength(limited.value),
                            truncated: limited.truncated,
                        });
                    } catch (error) {
                        this.ensureObserveTime(deadline);
                        artifacts.dom.push({ frameIndex: index, error: error.message });
                    }
                }
            }
        }

        const pageResult = {
            index: this.getReadyContext().pages().indexOf(page),
        };
        const pageUrl = limitText(page.url(), MAX_OBSERVE_METADATA_BYTES);
        pageResult.url = pageUrl.value;
        pageResult.urlTruncated = pageUrl.truncated;
        try {
            const title = limitText(await this.withObserveDeadline(page.title(), deadline), MAX_OBSERVE_METADATA_BYTES);
            pageResult.title = title.value;
            pageResult.titleTruncated = title.truncated;
        } catch (error) {
            this.ensureObserveTime(deadline);
            pageResult.title = '';
            pageResult.titleError = limitText(error.message, MAX_OBSERVE_METADATA_BYTES).value;
        }
        try {
            pageResult.viewport = page.viewportSize() || await this.withObserveDeadline(
                page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
                deadline,
            );
        } catch (error) {
            this.ensureObserveTime(deadline);
            pageResult.viewport = null;
            pageResult.viewportError = limitText(error.message, MAX_OBSERVE_METADATA_BYTES).value;
        }

        return {
            ok: true,
            action: 'observe',
            page: pageResult,
            frames: frameResults,
            frameLimit: MAX_OBSERVE_FRAMES,
            framesTruncated: frames.length > observedFrames.length,
            elementLimit: MAX_OBSERVE_ELEMENTS,
            elementsTruncated: remainingElements === 0,
            artifacts,
        };
    }

    /**
     * 执行元素动作并返回实际命中元素和前后状态。
     *
     * @param {string} action click/fill/type/press/select/check/uncheck。
     * @param {Object} options 动作参数。
     * @return {Promise<Object>} 动作结果。
     */
    async performElementAction(action, options) {
        const startedAt = Date.now();
        const page = this.getPage(options.index);
        const pageIndex = this.getReadyContext().pages().indexOf(page);
        const urlBefore = page.url();
        try {
            const resolved = await this.resolveTarget(page, options);
            const timeout = this.timeout(options);
            await this.ensureTargetActionable(resolved.locator, action);
            let actionResult = null;
            switch (action) {
                case 'click':
                    await resolved.locator.click({ timeout });
                    break;
                case 'fill':
                    if (options.value === undefined) throw new ControlError('INVALID_ARGUMENT', 'fill requires value');
                    await resolved.locator.fill(String(options.value), { timeout });
                    break;
                case 'type':
                    if (options.value === undefined) throw new ControlError('INVALID_ARGUMENT', 'type requires value');
                    await resolved.locator.pressSequentially(String(options.value), { timeout, delay: Number(options.delayMs || 0) });
                    break;
                case 'press':
                    if (!options.key) throw new ControlError('INVALID_ARGUMENT', 'press requires key');
                    await resolved.locator.press(String(options.key), { timeout });
                    break;
                case 'select': {
                    const values = options.values !== undefined ? options.values : options.value;
                    if (values === undefined) throw new ControlError('INVALID_ARGUMENT', 'select requires value or values');
                    actionResult = await resolved.locator.selectOption(values, { timeout });
                    break;
                }
                case 'check':
                    await resolved.locator.check({ timeout });
                    break;
                case 'uncheck':
                    await resolved.locator.uncheck({ timeout });
                    break;
                default:
                    throw new ControlError('UNKNOWN_ACTION', `unknown element action: ${action}`, { action }, 404);
            }
            return {
                ok: true,
                action,
                durationMs: Date.now() - startedAt,
                page: { index: pageIndex, urlBefore, urlAfter: page.url() },
                frame: resolved.frame,
                target: resolved.summary,
                result: actionResult,
            };
        } catch (error) {
            if (error instanceof ControlError) throw error;
            const code = error.name === 'TimeoutError' ? 'ACTION_TIMEOUT' : 'ACTION_FAILED';
            throw new ControlError(code, error.message, { action, url: page.url() }, code === 'ACTION_TIMEOUT' ? 408 : 500);
        }
    }

    /**
     * 收集 frame 内可交互元素的有界摘要。
     *
     * @param {import('playwright').Frame} frame 目标 frame。
     * @param {number} limit 最大元素数。
     * @return {Promise<Array<Object>>} 元素摘要。
     */
    async collectInteractiveElements(frame, limit) {
        return frame.locator('a[href],button,input,select,textarea,[role],[contenteditable="true"],[tabindex]').evaluateAll((elements, max) => {
            function short(value, length = 240) {
                return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
            }
            function roleOf(element) {
                if (element.getAttribute('role')) return element.getAttribute('role');
                if (element.tagName === 'INPUT') {
                    return {
                        submit: 'button', button: 'button', reset: 'button', image: 'button', file: 'button',
                        checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox',
                    }[String(element.type || 'text').toLowerCase()] || 'textbox';
                }
                return { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox' }[element.tagName] || '';
            }
            function labelOf(element) {
                const label = element.labels && element.labels[0];
                if (!label) return '';
                const clone = label.cloneNode(true);
                clone.querySelectorAll('input,select,textarea,button').forEach(control => control.remove());
                return short(clone.textContent);
            }
            function targetOf(element, role, name) {
                const testId = element.getAttribute('data-testid');
                if (testId && testId.length <= 240) return { testId };
                if (element.id && element.id.length <= 240) return { selector: `#${CSS.escape(element.id)}` };
                if (role && name) return { role, name, exact: true };
                const label = element.getAttribute('aria-label');
                if (label) return { role: role || undefined, name: short(label), exact: true };
                const placeholder = element.getAttribute('placeholder');
                if (placeholder) return { placeholder: short(placeholder), exact: true };
                if (name) return { text: name, exact: true };
                return { selector: element.tagName.toLowerCase() };
            }
            return elements.filter(element => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            }).slice(0, max).map(element => {
                const rect = element.getBoundingClientRect();
                const role = roleOf(element);
                const name = short(element.getAttribute('aria-label') || labelOf(element) || element.innerText || element.getAttribute('value') || element.getAttribute('placeholder'));
                return {
                    tag: element.tagName.toLowerCase(),
                    role,
                    name,
                    type: element.getAttribute('type') || '',
                    value: short(element.value),
                    disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
                    checked: 'checked' in element ? Boolean(element.checked) : null,
                    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    target: targetOf(element, role, name),
                };
            });
        }, limit);
    }

    /**
     * 在动作执行前检查稳定可判定的不可操作状态。
     *
     * @param {import('playwright').Locator} locator 唯一目标元素。
     * @param {string} action 动作名。
     * @return {Promise<void>} 元素可操作时完成。
     */
    async ensureTargetActionable(locator, action) {
        const needsEnabled = ['click', 'fill', 'type', 'press', 'select', 'check', 'uncheck'].includes(action);
        if (needsEnabled && typeof locator.isEnabled === 'function' && !(await locator.isEnabled())) {
            throw new ControlError('TARGET_NOT_ACTIONABLE', 'target is disabled', { action, reason: 'disabled' }, 409);
        }
        if (['fill', 'type'].includes(action) && typeof locator.isEditable === 'function' && !(await locator.isEditable())) {
            throw new ControlError('TARGET_NOT_ACTIONABLE', 'target is not editable', { action, reason: 'not-editable' }, 409);
        }
    }

    /**
     * 解析 frame 与 locator，并拒绝未显式消歧的多匹配。
     *
     * @param {import('playwright').Page} page 目标页面。
     * @param {Object} options 动作参数。
     * @return {Promise<{locator:import('playwright').Locator,frame:Object,summary:Object}>} 唯一目标。
     */
    async resolveTarget(page, options) {
        const frameInfo = this.resolveFrame(page, options.frame);
        const target = options.target || {};
        const strategies = TARGET_KEYS.filter(key => target[key] !== undefined && target[key] !== null && target[key] !== '');
        if (strategies.length !== 1) {
            throw new ControlError('INVALID_TARGET', 'target must contain exactly one locator strategy', { strategies });
        }
        let locator;
        switch (strategies[0]) {
            case 'selector': locator = frameInfo.frame.locator(String(target.selector)); break;
            case 'role': locator = frameInfo.frame.getByRole(String(target.role), { name: target.name, exact: Boolean(target.exact) }); break;
            case 'text': locator = frameInfo.frame.getByText(String(target.text), { exact: Boolean(target.exact) }); break;
            case 'label': locator = frameInfo.frame.getByLabel(String(target.label), { exact: Boolean(target.exact) }); break;
            case 'placeholder': locator = frameInfo.frame.getByPlaceholder(String(target.placeholder), { exact: Boolean(target.exact) }); break;
            case 'testId': locator = frameInfo.frame.getByTestId(String(target.testId)); break;
            default: throw new ControlError('INVALID_TARGET', 'unsupported locator strategy');
        }

        const count = await locator.count();
        const visible = [];
        for (let index = 0; index < count; index += 1) {
            if (await locator.nth(index).isVisible().catch(() => false)) visible.push(index);
        }
        const requestedNth = target.nth !== undefined ? Number(target.nth) : options.nth !== undefined ? Number(options.nth) : null;
        let selected;
        if (requestedNth !== null) {
            if (!Number.isInteger(requestedNth) || requestedNth < 0 || !visible.includes(requestedNth)) {
                throw new ControlError('TARGET_NOT_FOUND', 'requested nth target is not visible', { nth: requestedNth, visible });
            }
            selected = locator.nth(requestedNth);
        } else if (visible.length === 0) {
            throw new ControlError('TARGET_NOT_FOUND', 'no visible target matched', { target });
        } else if (visible.length > 1) {
            const candidates = [];
            for (const index of visible.slice(0, 10)) candidates.push(await this.summarizeLocator(locator.nth(index)));
            throw new ControlError('AMBIGUOUS_TARGET', 'multiple visible targets matched; pass target.nth explicitly', {
                count: visible.length,
                candidates,
            }, 409);
        } else {
            selected = locator.nth(visible[0]);
        }

        return {
            locator: selected,
            frame: { index: frameInfo.index, url: frameInfo.frame.url(), name: frameInfo.frame.name() },
            summary: await this.summarizeLocator(selected),
        };
    }

    /**
     * 解析目标 frame。
     *
     * @param {import('playwright').Page} page 目标页面。
     * @param {Object|undefined} selector frame 选择条件。
     * @return {{frame:import('playwright').Frame,index:number}} frame 结果。
     */
    resolveFrame(page, selector) {
        const frames = page.frames();
        if (!selector) return { frame: page.mainFrame(), index: frames.indexOf(page.mainFrame()) };
        if (selector.index !== undefined) {
            const index = Number(selector.index);
            if (Number.isInteger(index) && frames[index]) return { frame: frames[index], index };
            throw new ControlError('FRAME_NOT_FOUND', `no such frame: ${selector.index}`, { frames: frames.length });
        }
        if (selector.url) {
            const matches = frames.map((frame, index) => ({ frame, index })).filter(item => (
                selector.exact ? item.frame.url() === selector.url : item.frame.url().includes(selector.url)
            ));
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) throw new ControlError('FRAME_NOT_FOUND', 'frame URL matched multiple frames', { count: matches.length }, 409);
        }
        if (selector.name !== undefined) {
            const matches = frames.map((frame, index) => ({ frame, index })).filter(item => item.frame.name() === selector.name);
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) throw new ControlError('FRAME_NOT_FOUND', 'frame name matched multiple frames', { count: matches.length }, 409);
        }
        throw new ControlError('FRAME_NOT_FOUND', 'frame did not match', { selector });
    }

    /**
     * 生成实际元素摘要，供结果和歧义候选返回。
     *
     * @param {import('playwright').Locator} locator 唯一元素 locator。
     * @return {Promise<Object>} 元素摘要。
     */
    async summarizeLocator(locator) {
        return locator.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return {
                tag: element.tagName.toLowerCase(),
                id: element.id || '',
                role: element.getAttribute('role') || '',
                name: String(element.getAttribute('aria-label') || element.innerText || element.getAttribute('value') || '').replace(/\s+/g, ' ').trim().slice(0, 240),
                type: element.getAttribute('type') || '',
                disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
                checked: 'checked' in element ? Boolean(element.checked) : null,
                boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
        });
    }

    /**
     * 获取已就绪 BrowserContext。
     *
     * @param {boolean} [required] 未就绪时是否抛错。
     * @return {import('playwright').BrowserContext|null} 当前上下文。
     */
    getReadyContext(required = true) {
        const context = this.getContext();
        if (!context && required) throw new ControlError('BROWSER_NOT_READY', 'browser is not ready', null, 503);
        return context || null;
    }

    /**
     * 获取指定页面。
     *
     * @param {number|undefined} index 页面序号。
     * @return {import('playwright').Page} 目标页面。
     */
    getPage(index = 0) {
        const context = this.getReadyContext();
        const normalized = index === undefined || index === null ? 0 : Number(index);
        if (!Number.isInteger(normalized) || !context.pages()[normalized]) {
            throw new ControlError('PAGE_NOT_FOUND', `no such page: ${index}`, { pageCount: context.pages().length }, 404);
        }
        return context.pages()[normalized];
    }

    /**
     * 读取动作超时并限制到合理范围。
     *
     * @param {Object} options 动作参数。
     * @return {number} 超时毫秒数。
     */
    timeout(options) {
        const timeout = Number(options.timeoutMs || 10000);
        return Number.isFinite(timeout) ? Math.max(100, Math.min(timeout, 120000)) : 10000;
    }

    /**
     * 规范化页面导航失败，避免 HTTP 层退化为无上下文的 500。
     *
     * @param {string} action 导航动作。
     * @param {Error} error Playwright 错误。
     * @param {import('playwright').Page} page 当前页面。
     * @return {ControlError} 结构化控制错误。
     */
    navigationError(action, error, page) {
        const timedOut = error && error.name === 'TimeoutError';
        return new ControlError(
            timedOut ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED',
            error.message,
            { action, url: page.url() },
            timedOut ? 408 : 502,
        );
    }

    /**
     * 确认 observe 仍在总时间预算内。
     *
     * @param {number} deadline 截止时间戳。
     * @return {void}
     */
    ensureObserveTime(deadline) {
        if (Date.now() >= deadline) {
            throw new ControlError('OBSERVE_TIMEOUT', 'observe exceeded its overall timeout', null, 408);
        }
    }

    /**
     * 返回单个 frame 步骤可使用的剩余超时。
     *
     * @param {number} deadline 截止时间戳。
     * @return {number} 步骤超时毫秒数。
     */
    observeStepTimeout(deadline) {
        this.ensureObserveTime(deadline);
        return Math.max(100, Math.min(3000, deadline - Date.now()));
    }

    /**
     * 给不支持 timeout 参数的 Playwright 调用套用 observe 总预算。
     *
     * @template T
     * @param {Promise<T>} promise 待等待操作。
     * @param {number} deadline 截止时间戳。
     * @return {Promise<T>} 原操作结果。
     */
    async withObserveDeadline(promise, deadline) {
        this.ensureObserveTime(deadline);
        const remaining = deadline - Date.now();
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => reject(new ControlError(
                        'OBSERVE_TIMEOUT',
                        'observe exceeded its overall timeout',
                        null,
                        408,
                    )), remaining);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
}

/**
 * 创建统一浏览器控制器。
 *
 * @param {Object} options 配置项。
 * @param {()=>import('playwright').BrowserContext|null} options.getContext 获取 BrowserContext。
 * @param {string} options.sessionDir 当前会话目录。
 * @return {BrowserController} 控制器实例。
 */
function createBrowserController(options) {
    return new BrowserController(options);
}

module.exports = { BrowserController, ControlError, createBrowserController, limitText };
