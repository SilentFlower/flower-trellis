/**
 * 浏览器端事件监听注入脚本 —— RPA 增强版
 *
 * 通过 Playwright 的 addInitScript 在每个页面加载前注入。
 * 监听用户的所有交互、网络请求、路由变化和异常，实时 POST 给本地 logger。
 *
 * RPA 友好的元素详情包括：
 *   - 多种选择器策略（id / data-testid / aria / role+name / text / css / xpath）
 *   - 鼠标坐标（page / client / offset 三套坐标）
 *   - 元素状态（可见 / 禁用 / 选中 / 必填）
 *   - 元素布局（boundingBox）
 *   - 祖先链（最近 5 层父节点，结构化摘要）
 *   - DOM 上下文 outerHTML（contextHTML，语义容器优先 + 2KB 截断；AI 判别业务/噪音 click 用）
 *   - iframe 路径（在哪个 frame 里）
 *   - ARIA 信息（role / accessible name）
 *
 * 设计要点：
 *   1. 幂等：window.__loggerInjected 防重复绑定。
 *   2. 跳过 about:blank：浏览器内嵌的空白 iframe 没有有用事件，避免噪音。
 *   3. 批量+延迟发送：500ms 或攒满 10 条触发一次 flush。
 *   4. 页面卸载兜底：beforeunload / pagehide 时 sendBeacon 强制刷出。
 *   5. 敏感字段标记：命中 password / 含 password|secret|token|captcha 字段名的元素在 target.sensitive=true；
 *      value 默认透传原值（RPA 流程参考所需）；设 REDACT_SENSITIVE=true 才替换成 [REDACTED len=N]。
 */
(function () {
    // 幂等保护
    if (window.__loggerInjected) return 'already-injected';
    window.__loggerInjected = true;

    // about:blank 没有有用事件且 origin=null 会触发 CORS 噪音，直接跳过
    if (location.href === 'about:blank') return 'skipped-blank';

    console.log('[inject] boot at ' + location.href);

    // ============ 常量 ============

    const LOGGER = 'http://localhost:7777/log';

    /** 会话 ID：用于把同一个页面 / SPA 流程的事件串起来。整页跳转会产生新的 sessionId（属正常） */
    const SESSION_ID =
        window.__sessionId ||
        (window.__sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

    /**
     * 元素文本截断长度，避免日志爆炸
     * @type {number}
     */
    const MAX_TEXT_LEN = 200;

    /**
     * 是否对敏感字段（password / 含 password|secret|token|captcha 字段名）脱敏 value。
     * 默认 false：RPA 流程参考需要原值，target.sensitive 仍标 true 用于人工识别。
     * 改 true 则把 value 替换为 [REDACTED len=N]。
     * @type {boolean}
     */
    const REDACT_SENSITIVE = false;

    /**
     * 祖先链最大深度
     * @type {number}
     */
    const MAX_ANCESTOR_DEPTH = 5;

    /**
     * contextHTML 最大字符长度(超过截断)
     * @type {number}
     */
    const MAX_CONTEXT_HTML = 2048;

    // ============ 发送队列 ============

    const queue = [];
    let flushTimer = null;

    /**
     * 入队一个事件，达到阈值或超时后批量发送
     * @param {Object} event 事件对象，会自动补充 sessionId / clientTime / url / frame 信息
     */
    function send(event) {
        queue.push({
            sessionId: SESSION_ID,
            clientTime: new Date().toISOString(),
            url: location.href,
            frame: getFrameContext(),
            ...event,
        });
        if (queue.length >= 10) {
            flush();
        } else if (!flushTimer) {
            flushTimer = setTimeout(flush, 500);
        }
    }

    /**
     * 把队列里的事件全部发送
     * 优先 sendBeacon（卸载时也能发），失败时退回 fetch keepalive
     */
    function flush() {
        if (queue.length === 0) return;
        const batch = queue.splice(0);
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        const body = JSON.stringify(batch);
        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(LOGGER, new Blob([body], { type: 'application/json' }));
            } else {
                fetch(LOGGER, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    keepalive: true,
                });
            }
        } catch (e) {
            // 发送失败不抛出，避免影响业务页面
        }
    }

    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);

    // ============ 上下文：iframe / 视口 ============

    /**
     * 判断当前是否在 iframe 内，并给出从顶层 window 到当前 frame 的路径
     * @return {{inIframe: boolean, depth: number, framePath: string[]}}
     */
    function getFrameContext() {
        const inIframe = window.top !== window;
        if (!inIframe) return { inIframe: false, depth: 0 };
        const framePath = [];
        try {
            let cur = window;
            while (cur !== cur.top) {
                const fe = cur.frameElement;
                if (fe) {
                    framePath.unshift(
                        fe.name ||
                        fe.id ||
                        (fe.src ? `src=${fe.src.slice(0, 80)}` : `<${fe.tagName.toLowerCase()}>`)
                    );
                }
                cur = cur.parent;
            }
        } catch (e) {
            // 跨域父 frame 无法访问，忽略
            framePath.push('<cross-origin>');
        }
        return { inIframe: true, depth: framePath.length, framePath };
    }

    /**
     * 当前视口尺寸 + 滚动位置 + 设备像素比
     * @return {{width: number, height: number, scrollX: number, scrollY: number, dpr: number}}
     */
    function getViewport() {
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: Math.round(window.scrollX),
            scrollY: Math.round(window.scrollY),
            dpr: window.devicePixelRatio || 1,
        };
    }

    // ============ 元素详情提取 ============

    /**
     * 根据 HTML 规范推算元素的隐式 ARIA role
     * 仅覆盖常见标签，不追求完全准确
     * @param {Element} el
     * @return {string|null}
     */
    function getImplicitRole(el) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
        if (tag === 'button') return 'button';
        if (tag === 'input') {
            const t = (el.type || 'text').toLowerCase();
            return {
                submit: 'button', button: 'button', reset: 'button', image: 'button',
                checkbox: 'checkbox', radio: 'radio',
                range: 'slider', file: 'button',
                text: 'textbox', email: 'textbox', password: 'textbox',
                tel: 'textbox', url: 'textbox', number: 'spinbutton',
                search: 'searchbox',
            }[t] || 'textbox';
        }
        return {
            textarea: 'textbox', select: 'combobox', option: 'option',
            nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo',
            article: 'article', section: 'region', aside: 'complementary',
            h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
            img: 'img', form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem',
            dialog: 'dialog',
        }[tag] || null;
    }

    /**
     * 计算元素的"可访问名"（accessible name），简化版 ARIA 算法
     * 优先级：aria-label > aria-labelledby > 关联 label > 自身文本 > title > placeholder
     * @param {Element} el
     * @return {string|null}
     */
    function getAccessibleName(el) {
        const al = el.getAttribute('aria-label');
        if (al) return al.trim().slice(0, MAX_TEXT_LEN);

        const lb = el.getAttribute('aria-labelledby');
        if (lb) {
            const refs = lb.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean);
            if (refs.length) {
                return refs.map(r => (r.innerText || '').trim()).join(' ').slice(0, MAX_TEXT_LEN);
            }
        }

        if (el.id) {
            try {
                const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                if (label) return (label.innerText || '').trim().slice(0, MAX_TEXT_LEN);
            } catch (e) {}
        }

        const wrappingLabel = el.closest && el.closest('label');
        if (wrappingLabel) return (wrappingLabel.innerText || '').trim().slice(0, MAX_TEXT_LEN);

        const text = (el.innerText || el.textContent || '').trim();
        if (text) return text.slice(0, MAX_TEXT_LEN);

        return el.title || el.placeholder || null;
    }

    /**
     * 生成相对稳定的 CSS 选择器：从元素向上回溯，遇到 id 就停
     * @param {Element} el
     * @return {string}
     */
    function buildCssSelector(el) {
        const parts = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 8) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) {
                try {
                    parts.unshift('#' + CSS.escape(cur.id));
                } catch (e) {
                    parts.unshift(`[id="${cur.id}"]`);
                }
                break;
            }
            if (cur.className && typeof cur.className === 'string') {
                const cls = cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 2);
                if (cls.length) {
                    try {
                        part += '.' + cls.map(c => CSS.escape(c)).join('.');
                    } catch (e) {
                        // 个别奇怪 class 名 escape 失败，忽略 class
                    }
                }
            }
            const parent = cur.parentElement;
            if (parent) {
                const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                if (sameTag.length > 1) {
                    part += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
                }
            }
            parts.unshift(part);
            cur = cur.parentElement;
            depth++;
        }
        return parts.join(' > ');
    }

    /**
     * 生成 XPath：优先用 id 锚定，否则用 tag + 同级索引
     * @param {Element} el
     * @return {string}
     */
    function getXPath(el) {
        if (el.id) return `//*[@id="${el.id}"]`;
        const segs = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && segs.length < 12) {
            const parent = cur.parentElement;
            if (!parent) {
                segs.unshift(cur.tagName.toLowerCase());
                break;
            }
            const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
            const idx = sameTag.length > 1 ? `[${sameTag.indexOf(cur) + 1}]` : '';
            segs.unshift(cur.tagName.toLowerCase() + idx);
            if (cur === document.body) break;
            cur = parent;
        }
        return '/' + segs.join('/');
    }

    /**
     * 收集所有 RPA 可用的选择器策略，按稳定性从高到低排序
     * 调用方按顺序尝试，第一个能唯一定位的就用
     * @param {Element} el
     * @return {Object} 选择器集合
     */
    function buildSelectors(el) {
        const sel = {};

        // 1. test-id 类（最稳定，前端约定的测试钩子）
        const testId =
            el.getAttribute('data-testid') ||
            el.getAttribute('data-test') ||
            el.getAttribute('data-cy') ||
            el.getAttribute('data-qa');
        if (testId) sel.testId = `[data-testid="${testId}"]`;

        // 2. id
        if (el.id) {
            try { sel.id = '#' + CSS.escape(el.id); }
            catch (e) { sel.id = `[id="${el.id}"]`; }
        }

        // 3. name 属性（表单元素）
        if (el.name) sel.name = `${el.tagName.toLowerCase()}[name="${el.name}"]`;

        // 4. aria-label
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) sel.ariaLabel = `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;

        // 5. role + accessible name（Playwright 推荐的最佳实践）
        const role = el.getAttribute('role') || getImplicitRole(el);
        const accName = getAccessibleName(el);
        if (role && accName) {
            sel.role = `role=${role}[name="${accName.slice(0, 50).replace(/"/g, '\\"')}"]`;
        }

        // 6. text 文本（适合按钮/链接）
        if (accName && accName.length < 50) {
            sel.text = `text="${accName.replace(/"/g, '\\"')}"`;
        }

        // 7. 通用 CSS 选择器
        sel.css = buildCssSelector(el);

        // 8. XPath（兜底）
        sel.xpath = getXPath(el);

        return sel;
    }

    /**
     * 提取元素的 DOM 上下文 outerHTML
     * 策略：语义容器(form/fieldset/[role=dialog]/main/.modal/.popup)优先,
     *      找不到回退 2 层祖先;总截断 MAX_CONTEXT_HTML 字节。
     * sensitive 字段处理：跟随 REDACT_SENSITIVE 开关 —— true 时把 outerHTML
     *      中 sensitive input 的 value 替换为 [REDACTED len=N]。
     *
     * 与 ancestors(结构化祖先链)互补：ancestors 给 tag/id/class 摘要,
     * contextHTML 给原 HTML 文本,AI 在判别"业务 click vs fingerprint 噪音"
     * 时(rpa-draft 关键场景)有完整 DOM 上下文,而非仅靠 selectors 推断。
     *
     * @param {Element} el 当前事件 target
     * @return {string|undefined} outerHTML(可能含 [...truncated len=N] 标记);
     *      detached DOM / 计算失败返 undefined
     */
    function getContextHTML(el) {
        if (!el || el.nodeType !== 1) return undefined;
        try {
            // 1. 找最近语义容器
            const containerSelector = 'form, fieldset, [role=dialog], main, .modal, .popup';
            const container = el.closest ? el.closest(containerSelector) : null;
            let target;
            if (container) {
                target = container;
            } else {
                // 2. 回退 2 层祖先(或更少)
                target = el.parentElement?.parentElement || el.parentElement || el;
            }
            let html = target.outerHTML || '';
            // 3. sensitive redact(仅当 REDACT_SENSITIVE=true)
            if (REDACT_SENSITIVE) {
                html = html.replace(
                    /<input([^>]*?(?:type="password"|name="(?:password|secret|token|captcha)[^"]*")[^>]*?)\bvalue="([^"]*)"/gi,
                    (m, attrs, val) => m.replace(/value="[^"]*"/, `value="[REDACTED len=${val.length}]"`)
                );
            }
            // 4. 截断 MAX_CONTEXT_HTML
            if (html.length > MAX_CONTEXT_HTML) {
                const origLen = html.length;
                html = html.slice(0, MAX_CONTEXT_HTML) + `<!-- ...truncated len=${origLen} -->`;
            }
            return html;
        } catch (e) {
            // outerHTML 计算失败(detached DOM / shadow root 越界等)不抛错
            return undefined;
        }
    }

    /**
     * 提取元素的祖先链（最近 N 层父节点），方便人工判读上下文
     * @param {Element} el
     * @return {Array}
     */
    function getAncestors(el) {
        const list = [];
        let cur = el.parentElement;
        while (cur && list.length < MAX_ANCESTOR_DEPTH) {
            const classes = cur.className && typeof cur.className === 'string'
                ? cur.className.trim().split(/\s+/).slice(0, 3)
                : undefined;
            list.push({
                tag: cur.tagName.toLowerCase(),
                id: cur.id || undefined,
                classes: classes && classes.length ? classes : undefined,
                role: cur.getAttribute('role') || undefined,
                testId: cur.getAttribute('data-testid') || undefined,
            });
            cur = cur.parentElement;
        }
        return list;
    }

    /**
     * 检查元素是否可见（用于判断是否能真实交互）
     * @param {Element} el
     * @return {boolean}
     */
    function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        try {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
        } catch (e) {}
        return true;
    }

    /**
     * RPA 级元素信息提取——包含所有重放/分析需要的细节
     *
     * @param {Element} el DOM 元素
     * @return {Object|null}
     */
    function getRichElementInfo(el) {
        if (!el || el.nodeType !== 1) return null;

        // 敏感字段判定
        const isSensitive =
            el.type === 'password' ||
            /password|secret|token|captcha/i.test((el.name || '') + ' ' + (el.id || ''));

        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || getImplicitRole(el);
        const accName = getAccessibleName(el);

        // 收集 data-* 和部分常用属性
        const attrs = {};
        for (const a of el.attributes || []) {
            if (a.name.startsWith('data-') || a.name.startsWith('aria-')) {
                attrs[a.name] = a.value.slice(0, 200);
            }
        }
        ['href', 'src', 'target', 'rel', 'alt', 'title', 'placeholder', 'type'].forEach(k => {
            const v = el.getAttribute && el.getAttribute(k);
            if (v != null && v !== '') attrs[k] = String(v).slice(0, 200);
        });

        return {
            // 基础标识
            tag,
            type: el.type || undefined,
            id: el.id || undefined,
            name: el.name || undefined,
            classes: el.className && typeof el.className === 'string'
                ? el.className.trim().split(/\s+/).filter(Boolean)
                : undefined,

            // 多种选择器（按稳定性排序，给 RPA 自由选择）
            selectors: buildSelectors(el),

            // 语义信息（ARIA / 可访问名）
            role: role || undefined,
            accessibleName: accName || undefined,

            // 文本内容
            innerText: (el.innerText || '').trim().slice(0, MAX_TEXT_LEN) || undefined,
            textContent: (el.textContent || '').trim().slice(0, MAX_TEXT_LEN) || undefined,

            // 状态（影响是否能交互）
            state: {
                visible: isVisible(el),
                disabled: el.disabled || undefined,
                checked: el.checked || undefined,
                readonly: el.readOnly || undefined,
                required: el.required || undefined,
            },

            // 布局位置（用于截图标注或视觉验证）
            boundingBox: rect.width || rect.height ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            } : undefined,

            // 关键属性
            attributes: Object.keys(attrs).length ? attrs : undefined,

            // 祖先上下文（最近 5 层父节点，提供位置语义）
            ancestors: getAncestors(el),

            // DOM 上下文 outerHTML（语义容器优先,2KB 截断;与 ancestors 互补——
            // 后者是结构化摘要,这里是原 HTML 文本,AI 判别业务/噪音 click 时用）
            contextHTML: getContextHTML(el),

            // 敏感字段标记
            sensitive: isSensitive || undefined,
        };
    }

    // ============ 交互事件监听 ============

    /**
     * 提取鼠标事件的坐标和按键信息
     * @param {MouseEvent} e
     * @return {Object}
     */
    function getMouseInfo(e) {
        return {
            button: e.button,                  // 0=左键, 1=中键, 2=右键
            buttons: e.buttons,                // 按下的所有键位掩码
            pageX: Math.round(e.pageX),
            pageY: Math.round(e.pageY),
            clientX: Math.round(e.clientX),
            clientY: Math.round(e.clientY),
            offsetX: Math.round(e.offsetX),    // 相对元素左上角
            offsetY: Math.round(e.offsetY),
        };
    }

    /**
     * 提取修饰键状态
     * @param {Event} e
     * @return {Object}
     */
    function getModifiers(e) {
        return {
            ctrl: e.ctrlKey || undefined,
            meta: e.metaKey || undefined,
            alt: e.altKey || undefined,
            shift: e.shiftKey || undefined,
        };
    }

    // click / dblclick / contextmenu：捕获鼠标 + 视口 + 富元素信息
    ['click', 'dblclick', 'contextmenu'].forEach(type => {
        document.addEventListener(type, e => {
            send({
                kind: 'interaction',
                type,
                mouse: getMouseInfo(e),
                modifiers: getModifiers(e),
                viewport: getViewport(),
                target: getRichElementInfo(e.target),
            });
        }, true);
    });

    // 表单提交
    document.addEventListener('submit', e => {
        send({
            kind: 'interaction',
            type: 'submit',
            target: getRichElementInfo(e.target),
            // 顺手把表单字段名 + 是否敏感快照出来，方便看提交了什么
            formFields: e.target.elements ? Array.from(e.target.elements)
                .filter(el => el.name)
                .map(el => ({
                    name: el.name,
                    tag: el.tagName.toLowerCase(),
                    type: el.type,
                    valueLength: (el.value || '').length,
                    sensitive: el.type === 'password' || /password|secret|token/i.test(el.name) || undefined,
                })) : undefined,
        });
    }, true);

    // input：节流，停顿 400ms 才落一条最终状态
    const inputTimers = new WeakMap();
    document.addEventListener('input', e => {
        const t = e.target;
        if (inputTimers.has(t)) clearTimeout(inputTimers.get(t));
        inputTimers.set(t, setTimeout(() => {
            const info = getRichElementInfo(t);
            const val = t.value || '';
            send({
                kind: 'interaction',
                type: 'input',
                target: info,
                value: (info.sensitive && REDACT_SENSITIVE) ? `[REDACTED len=${val.length}]` : val.slice(0, MAX_TEXT_LEN),
                valueLength: val.length,
                viewport: getViewport(),
            });
            inputTimers.delete(t);
        }, 400));
    }, true);

    // change：select / checkbox / radio / file
    document.addEventListener('change', e => {
        const t = e.target;
        const handled = t.tagName === 'SELECT' ||
            t.type === 'checkbox' || t.type === 'radio' || t.type === 'file';
        if (!handled) return;
        send({
            kind: 'interaction',
            type: 'change',
            target: getRichElementInfo(t),
            value: t.type === 'file'
                ? Array.from(t.files || []).map(f => ({ name: f.name, size: f.size, type: f.type }))
                : t.value,
            checked: t.checked,
            // select 顺便把选中项的 text 也带上
            selectedText: t.tagName === 'SELECT' && t.selectedOptions[0]
                ? t.selectedOptions[0].text : undefined,
        });
    }, true);

    // 特殊键 + 组合键
    document.addEventListener('keydown', e => {
        const specialKeys = [
            'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
            'PageUp', 'PageDown', 'Home', 'End', ' ',
        ];
        const isCombo = e.ctrlKey || e.metaKey || (e.altKey && e.key !== 'Alt');
        if (!specialKeys.includes(e.key) && !isCombo) return;
        // 修饰键本身按下时不重复记（避免 alt+Alt 这种）
        if (['Alt', 'Control', 'Meta', 'Shift'].includes(e.key) && !isCombo) return;
        send({
            kind: 'interaction',
            type: 'keydown',
            key: e.key,
            code: e.code,
            modifiers: getModifiers(e),
            target: getRichElementInfo(e.target),
        });
    }, true);

    // ============ 网络请求拦截 ============

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
        const [input, init = {}] = args;
        const url = typeof input === 'string' ? input : input.url;
        const method = init.method || (typeof input !== 'string' && input.method) || 'GET';
        const start = performance.now();
        try {
            const resp = await origFetch.apply(this, args);
            send({
                kind: 'network',
                type: 'fetch',
                method,
                requestUrl: url,
                status: resp.status,
                durationMs: Math.round(performance.now() - start),
            });
            return resp;
        } catch (err) {
            send({
                kind: 'network',
                type: 'fetch',
                method,
                requestUrl: url,
                error: err.message,
                durationMs: Math.round(performance.now() - start),
            });
            throw err;
        }
    };

    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
        const xhr = new OrigXHR();
        let _method, _url, _start;
        const origOpen = xhr.open;
        xhr.open = function (method, url, ...rest) {
            _method = method;
            _url = url;
            return origOpen.call(this, method, url, ...rest);
        };
        const origSend = xhr.send;
        xhr.send = function (...args) {
            _start = performance.now();
            xhr.addEventListener('loadend', () => {
                send({
                    kind: 'network',
                    type: 'xhr',
                    method: _method,
                    requestUrl: _url,
                    status: xhr.status,
                    durationMs: Math.round(performance.now() - _start),
                });
            });
            return origSend.apply(this, args);
        };
        return xhr;
    };

    // ============ SPA 路由 ============

    ['pushState', 'replaceState'].forEach(type => {
        const orig = history[type];
        history[type] = function (...args) {
            send({
                kind: 'navigation',
                type: `history.${type}`,
                from: location.href,
                to: args[2],
            });
            return orig.apply(this, args);
        };
    });
    window.addEventListener('popstate', () => {
        send({ kind: 'navigation', type: 'popstate', to: location.href });
    });

    // ============ 异常 ============

    window.addEventListener('error', e => {
        send({
            kind: 'error',
            type: 'window.error',
            message: e.message,
            source: e.filename,
            line: e.lineno,
            col: e.colno,
        });
    });
    window.addEventListener('unhandledrejection', e => {
        send({
            kind: 'error',
            type: 'unhandledrejection',
            reason: String(e.reason).slice(0, 500),
        });
    });

    // ============ 启动：发送 pageload ============

    send({
        kind: 'navigation',
        type: 'pageload',
        to: location.href,
        title: document.title,
        referrer: document.referrer,
        viewport: getViewport(),
        userAgent: navigator.userAgent,
    });

    return 'injected';
})();
