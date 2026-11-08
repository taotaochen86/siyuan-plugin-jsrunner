/**
 * JS Bridge for SiYuan
 * ------------------------------------------------------------------
 * 让外部程序（Quicker、WorkBuddy、脚本、其他应用）把 JavaScript 送进思源
 * 渲染进程执行，并把返回值 / 日志 / 错误原路带回去。
 *
 * 为什么必须做成插件而不是调内核 API：
 *   内核（6806）是无状态的，光标、选区、Protyle 实例全都在渲染进程里，
 *   /api/* 里没有任何 cursor/selection 路由。只有跑在渲染进程里的代码
 *   才拿得到 document.getSelection() 和当前块 ID。
 *
 * 运行形态：桌面端 Electron 渲染进程 nodeIntegration: true，因此可以
 *   直接 require("http") 起一个只监听 127.0.0.1 的小服务。
 *
 * 安全边界：仅回环地址 + 令牌校验 + 请求体上限 + 执行超时 + 串行执行。
 *   它能执行任意 JS（等同于思源自身的权限），令牌泄露 = 电脑被控，
 *   所以默认不开 allowRemote。
 */

const {Plugin, Setting, Menu, Dialog, showMessage, fetchSyncPost} = require("siyuan");

const CONF = "config.json";
const DEFAULTS = {
    enabled: true,
    port: 6866,
    token: "",
    allowRemote: false,
    timeoutMs: 15000,
    maxBodyKB: 2048,
    logRuns: true,
};

// 非桌面端（手机 / 浏览器）没有 node 环境，这里必须容错，不能抛到顶层
let http = null;
try {
    http = require("http");
} catch (e) {
    http = null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (fn, options) => {
    const opt = Object.assign({timeout: 5000, interval: 100}, options || {});
    const start = Date.now();
    for (;;) {
        let value;
        try {
            value = await fn();
        } catch (e) {
            value = undefined;
        }
        if (value) {
            return value;
        }
        if (Date.now() - start > opt.timeout) {
            return undefined;
        }
        await sleep(opt.interval);
    }
};

const fmt = (value) => {
    if (typeof value === "string") {
        return value;
    }
    if (value instanceof Error) {
        return value.stack || value.message;
    }
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
};

const randToken = () => {
    try {
        return require("crypto").randomBytes(16).toString("hex");
    } catch (e) {
        return "sk" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
};

const isBlockElement = (el) => !!el && el.tagName !== "BUTTON" && typeof el.getAttribute === "function" &&
    (el.getAttribute("data-type") || "").startsWith("Node");

/**
 * 从任意节点向上找「真正的块」，同时识别表格单元格。
 *
 * 表格是特例：思源把单元格内容渲染在一个 lite 编辑器里
 * （.table__cell-editor.protyle-lite-fragment），里面还嵌着一层 .protyle-wysiwyg。
 * 那层里的段落 ID 是临时的，blocks 表查不到（getBlockInfo 会报「未找到」），
 * 所以对外必须返回真正的表格块（data-type="NodeTable"），单元格信息单独给。
 */
const resolveBlock = (node) => {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    let inner = null;
    let cellEl = null;
    while (el) {
        if (!cellEl && (el.tagName === "TD" || el.tagName === "TH")) {
            cellEl = el;
        }
        if (!inner && isBlockElement(el) && el.hasAttribute("data-node-id")) {
            inner = el;
        }
        // 表格块就是最终答案
        if (el.getAttribute && el.getAttribute("data-type") === "NodeTable") {
            return {blockEl: el, innerEl: inner, cellEl};
        }
        // 只认「正文最外层」的 wysiwyg；单元格里那层要继续往上走
        if (el.classList.contains("protyle-wysiwyg") &&
            !(el.closest && el.closest(".table__cell-editor"))) {
            break;
        }
        el = el.parentElement;
    }
    return {blockEl: inner, innerEl: inner, cellEl};
};

/** 穿过单元格的 lite 编辑器，取最外层正文根 */
const outerRoot = (el) => {
    let root = el;
    for (let i = 0; i < 5 && root; i++) {
        const cell = root.closest ? root.closest(".table__cell-editor") : null;
        if (!cell) {
            return root;
        }
        const up = cell.closest(".protyle-wysiwyg") || cell.closest(".protyle-title");
        if (!up || up === root) {
            return root;
        }
        root = up;
    }
    return root;
};

/** 单元格的干净 HTML：去掉拖拽/加号那圈编辑器控件 */
const cellHtml = (cellEl) => {
    if (!cellEl || typeof cellEl.cloneNode !== "function") {
        return null;
    }
    const clone = cellEl.cloneNode(true);
    const junk = clone.querySelectorAll ? clone.querySelectorAll(".protyle-table-control") : [];
    for (let i = 0; i < junk.length; i++) {
        if (junk[i].parentNode) {
            junk[i].parentNode.removeChild(junk[i]);
        }
    }
    return typeof clone.outerHTML === "string" ? clone.outerHTML : null;
};

/** 单元格位置与文本 */
const cellBrief = (cellEl, withHtml) => {
    if (!cellEl) {
        return null;
    }
    const tr = cellEl.parentElement;
    return {
        tag: cellEl.tagName ? cellEl.tagName.toLowerCase() : null,
        row: tr && typeof tr.rowIndex === "number" ? tr.rowIndex : null,
        col: typeof cellEl.cellIndex === "number" ? cellEl.cellIndex : null,
        text: (cellEl.textContent || "").replace(/\u200b/g, "").trim().slice(0, 200),
        html: withHtml ? cellHtml(cellEl) : null,
    };
};

/* ============================ DOM 快照工具 ============================ */

// 判定是否 DOM 节点。真实浏览器两者都有；测试桩 / 某些代理对象可能只有 tagName，
// 所以两个名字任意一个成立就认，避免漏判后撞上 parentNode 循环引用
const isDomNode = (v) => !!v && typeof v === "object" && typeof v.nodeType === "number" &&
    (typeof v.nodeName === "string" || typeof v.tagName === "string");

/**
 * 把一个 DOM 元素压成纯数据快照。
 * withHtml = true 时带上完整 outerHTML（不截断），可直接交给外部程序。
 */
const domBrief = (el, withHtml) => {
    if (!el) {
        return null;
    }
    const attr = (name) => (el.getAttribute ? el.getAttribute(name) : null);
    return {
        tag: el.tagName ? el.tagName.toLowerCase() : String(el.nodeName || "").toLowerCase(),
        className: typeof el.className === "string" ? el.className : null,
        dataType: attr("data-type"),
        nodeId: attr("data-node-id"),
        childCount: el.childNodes ? el.childNodes.length : 0,
        textLength: (el.textContent || "").length,
        html: withHtml && typeof el.outerHTML === "string" ? el.outerHTML : null,
    };
};

/**
 * 把任意返回值压成可 JSON 序列化的结构。
 *
 * 为什么必须有：脚本里 `return getBlockEl()` 返回的是真 DOM 元素，
 * 元素带 parentNode / ownerDocument 循环引用，JSON.stringify 会直接抛
 * "Converting circular structure to JSON"，整个 HTTP 响应就废了。
 * 这里统一把 DOM 节点换成 outerHTML 快照，脚本作者不用操心。
 */
const sanitize = (value, depth) => {
    const d = depth || 0;
    if (value === undefined || value === null) {
        return null;
    }
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") {
        return value;
    }
    if (t === "function") {
        return "[Function " + (value.name || "anonymous") + "]";
    }
    if (t === "symbol" || t === "bigint") {
        return String(value);
    }
    if (t !== "object") {
        return String(value);
    }
    if (isDomNode(value)) {
        return value.nodeType === 3
            ? {nodeType: 3, text: value.nodeValue}
            : domBrief(value, true);
    }
    if (value instanceof Error || (typeof value.message === "string" && typeof value.stack === "string" && value.name)) {
        return {name: value.name, message: value.message, stack: value.stack};
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (d >= 8) {
        return "[max depth]";
    }
    if (Array.isArray(value)) {
        const out = value.slice(0, 500).map((v) => sanitize(v, d + 1));
        if (value.length > 500) {
            out.push("[+" + (value.length - 500) + " more]");
        }
        return out;
    }
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
        if (i >= 200) {
            out.__truncated__ = keys.length - 200;
            break;
        }
        out[keys[i]] = sanitize(value[keys[i]], d + 1);
    }
    return out;
};

/* ============================ 行元素归一化 ============================ */

// 这些行内标签本身就是「行元素」，命中就不用再往上爬
const INLINE_LINE_TAGS = new Set([
    "A", "STRONG", "EM", "B", "I", "U", "S", "DEL", "INS", "CODE", "MARK",
    "SUP", "SUB", "IMG", "Q", "CITE", "SMALL", "KBD", "SAMP", "VAR", "MATH",
]);

// 公式宿主：行级公式是 span[data-type=inline-math]，块级公式是 div[data-type=NodeMathBlock]
const MATH_HOST_SELECTOR = '[data-type="inline-math"], [data-type="NodeMathBlock"]';

module.exports = class JsBridge extends Plugin {

    async onload() {
        const saved = (await this.loadData(CONF)) || {};
        this.config = Object.assign({}, DEFAULTS, saved);
        if (!this.config.token) {
            this.config.token = randToken();
            await this.saveData(CONF, this.config);
        }
        this._server = null;
        this._running = false;
        this._startedAt = 0;
        this._runs = 0;
        this._lastRun = null;
        this._queue = Promise.resolve();
        this._mem = new WeakMap();

        this._installFocusMemory();
        this._installPointerMemory();
        this._addUI();
        this._exposeToConsole();
        if (this.config.enabled && http) {
            await this._startServer();
        } else if (!http) {
            console.warn("[jsbridge] 当前环境没有 node 的 http 模块，仅支持本地面板运行");
        }
        console.log("[jsbridge] loaded, enabled =", this.config.enabled, "port =", this.config.port);
    }

    onunload() {
        this._stopServer();
        this._removeFocusMemory();
        this._removePointerMemory();
        try {
            if (typeof window !== "undefined") {
                delete window.__jsBridge;
            }
        } catch (e) {
            // ignore
        }
        console.log("[jsbridge] unloaded");
    }

    /**
     * 把几个函数挂到 window.__jsBridge，方便直接按 Ctrl+Shift+I 在控制台里试：
     *   __jsBridge.getBlockHTML()
     *   __jsBridge.run("return getCursor()")
     * 只挂一个命名空间，不污染全局。
     */
    _exposeToConsole() {
        try {
            if (typeof window === "undefined") {
                return;
            }
            window.__jsBridge = {
                getCursor: (opt) => this.getCursorInfo(opt),
                getBlockEl: () => this.getBlockElement(),
                getLineEl: () => this.getLineElement(),
                getBlockHTML: () => this.getBlockHTML(),
                getLineHTML: () => this.getLineHTML(),
                getDom: () => this.getDomInfo(),
                getMouse: (opt) => this.getMouseInfo(opt),
                getMouseBlockEl: (sel) => this.getMouseBlockElement(sel),
                getMouseLineEl: (sel) => this.getMouseLineElement(sel),
                getMouseBlockHTML: (sel) => this.getMouseBlockHTML(sel),
                getMouseLineHTML: (sel) => this.getMouseLineHTML(sel),
                run: (code, opt) => this._enqueue(String(code), opt || {}),
                plugin: this,
            };
        } catch (e) {
            console.warn("[jsbridge] 挂载 __jsBridge 失败", e);
        }
    }

    /* ============================ 选区记忆 ============================ */
    /* 与思源官方 editorFocusMemory 同构：点侧栏 / 搜索框后仍能取到最后正文光标 */

    _installFocusMemory() {
        const mem = this._mem;
        // 记录的「已知正文根」。选中被清空后 selection 不再落在正文里，
        // 仍能凭它判断「这是一次离开正文的操作」，而不是「从未进过正文」
        let lastRoot = null;
        const captureFrom = (root, range) => {
            const node = range.startContainer;
            if (!node || !root.contains(node)) {
                return;
            }
            lastRoot = root;
            mem.set(root, {
                range: range.cloneRange(),
                node,
                offset: range.startOffset,
                value: node.nodeValue,
                before: node.childNodes[range.startOffset - 1] || null,
                after: node.childNodes[range.startOffset] || null,
            });
        };
        const rootOf = (node) => {
            const host = node && (node.nodeType === 1 ? node : node.parentElement);
            if (!host || !host.closest) {
                return null;
            }
            // 正文用 .protyle-wysiwyg，文档标题用 .protyle-title（它不在 wysiwyg 内）
            return host.closest(".protyle-wysiwyg") || host.closest(".protyle-title");
        };
        // 离开正文前最后一次真实选区。必须是 Range 对象（cloneRange 出来的），
        // 不能依赖 event.target —— pointerdown 的 target 可能是侧栏元素
        let lastRange = null;

        this._remember = () => {
            const sel = document.getSelection();
            if (!sel || !sel.rangeCount) {
                return;
            }
            const range = sel.getRangeAt(0);
            if (!range || !range.startContainer) {
                return;
            }
            const root = rootOf(range.startContainer);
            if (root && root.contains(range.endContainer)) {
                lastRange = range.cloneRange();
                captureFrom(root, range);
                return;
            }
            // 焦点已移出正文（点侧栏、输入框、搜索框）：用离开前那份位置补齐
            if (lastRoot && lastRange) {
                captureFrom(lastRoot, lastRange);
            }
        };
        document.addEventListener("selectionchange", this._remember);
        document.addEventListener("pointerdown", this._remember, true);
        document.addEventListener("focusout", this._remember, true);
    }

    _removeFocusMemory() {
        if (!this._remember) {
            return;
        }
        document.removeEventListener("selectionchange", this._remember);
        document.removeEventListener("pointerdown", this._remember, true);
        document.removeEventListener("focusout", this._remember, true);
        this._remember = null;
    }

    /** 按需生成的「最后正文光标」——只算一次，失败静默（不影响脚本主体） */
    _cursorLazy() {
        let cache;
        let done = false;
        let value = null;
        return () => {
            if (!done) {
                done = true;
                try {
                    value = this.getCursorInfo();
                } catch (e) {
                    value = null;
                }
            }
            return value;
        };
    }

    /**
     * 解析「当前上下文」。
     * 优先级：真实选区 → 记忆选区（点过侧栏也能用）→ null
     * 返回 {root, range, source, blockEl, lineEl, titleEl}
     */
    _resolveContext() {
        const roots = Array.from(document.querySelectorAll(".protyle-wysiwyg, .protyle-title"));
        const sel = document.getSelection();
        const current = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        let picked = null;

        if (current && current.startContainer) {
            const root = roots.find((r) => r.contains(current.startContainer) && r.contains(current.endContainer));
            if (root) {
                picked = {root, range: current, source: "selection"};
            }
        }
        if (!picked) {
            const valid = [];
            for (const root of roots) {
                const s = this._mem.get(root);
                if (!s || !s.node.isConnected || s.value !== s.node.nodeValue) {
                    continue;
                }
                // 快照里存的 range 可能在浏览器操作后被就地改写，所以自己按 offset 重建一份
                const offset = s.range.startOffset;
                if (s.offset !== undefined && s.offset !== offset) {
                    continue;
                }
                if (s.before !== (s.node.childNodes[offset - 1] || null) ||
                    s.after !== (s.node.childNodes[offset] || null)) {
                    continue;
                }
                const range = document.createRange ? document.createRange() : null;
                if (!range || typeof range.setStart !== "function") {
                    continue;
                }
                range.setStart(s.node, offset);
                range.setEnd(s.node, offset);
                valid.push({root, range, source: "memory"});
            }
            picked = valid.find((v) => v.root.closest && v.root.closest(".layout__wnd--active")) ||
                valid[valid.length - 1] || null;
        }
        if (!picked) {
            return null;
        }

        const range = picked.range;
        const startNode = range.startContainer;
        if (!startNode) {
            return null;
        }
        // 光标可能在表格单元格的 lite 编辑器里，文档信息必须从最外层根算
        const rootOuter = outerRoot(picked.root);
        const protyleEl = rootOuter.closest ? rootOuter.closest(".protyle") : null;
        const titleEl = protyleEl ? protyleEl.querySelector(".protyle-title") : null;

        const found = resolveBlock(startNode);
        let blockEl = found.blockEl;
        if (!blockEl) {
            // 标题区（.protyle-title 不在 .protyle-wysiwyg 内）单独兜底
            if (picked.root.classList && picked.root.classList.contains("protyle-title")) {
                blockEl = picked.root;
            } else if (titleEl && titleEl.contains(startNode)) {
                blockEl = titleEl;
            }
        }
        // 「当前行元素」= 光标直接落在的那个元素（text node 取其父元素）
        const lineEl = (startNode.nodeType === 3 ? startNode.parentElement : startNode) || blockEl;

        return {
            root: picked.root,
            rootOuter,
            range,
            source: picked.source,
            blockEl,
            innerEl: found.innerEl,
            cellEl: found.cellEl,
            lineEl,
            titleEl,
        };
    }

    /** 当前块元素（真 DOM 对象），可直接 .querySelector / 改样式 / 读属性 */
    getBlockElement() {
        const ctx = this._resolveContext();
        return ctx ? ctx.blockEl : null;
    }

    /** 当前行元素（真 DOM 对象）：光标直接所在的 <strong> / <span> / <div class="p"> 等 */
    getLineElement() {
        const ctx = this._resolveContext();
        return ctx ? ctx.lineEl : null;
    }

    /** 整个块的 outerHTML 字符串（完整，不截断） */
    getBlockHTML() {
        const el = this.getBlockElement();
        return el && typeof el.outerHTML === "string" ? el.outerHTML : null;
    }

    /** 当前行元素的 outerHTML 字符串 */
    getLineHTML() {
        const el = this.getLineElement();
        return el && typeof el.outerHTML === "string" ? el.outerHTML : null;
    }

    /* ============================ 鼠标处（:hover） ============================ */

    /* ============================ 指针记忆 ============================ */

    /**
     * 记住指针最后压过的元素。
     * 为什么需要：:hover 只在指针真的停在思源窗口上时才有效。用户从终端 / Quicker
     * 触发请求时指针往往已经移开，:hover 变成空链，端点只能 404。
     * 只监听 mouseover / mousedown（进入元素时才触发，开销可忽略），不拦截事件。
     */
    _installPointerMemory() {
        this._pointer = {el: null, x: 0, y: 0, ts: 0};
        this._pointerMove = (e) => {
            const t = e && e.target;
            if (!t || t.nodeType !== 1) {
                return;
            }
            // 只记「落在正文块上」的位置：编辑器空白、侧栏、工具栏不覆盖已有的有效记忆
            if (!t.closest || !(t.closest(".protyle-wysiwyg") || t.closest(".protyle-title"))) {
                return;
            }
            const found = resolveBlock(t);
            if (!found.blockEl && !t.closest(".protyle-title")) {
                return;
            }
            this._pointer.el = t;
            this._pointer.x = e.clientX || 0;
            this._pointer.y = e.clientY || 0;
            this._pointer.ts = Date.now();
        };
        if (typeof document !== "undefined" && document.addEventListener) {
            document.addEventListener("mouseover", this._pointerMove, true);
            document.addEventListener("mousedown", this._pointerMove, true);
        }
    }

    _removePointerMemory() {
        if (this._pointerMove && typeof document !== "undefined" && document.removeEventListener) {
            document.removeEventListener("mouseover", this._pointerMove, true);
            document.removeEventListener("mousedown", this._pointerMove, true);
        }
        this._pointerMove = null;
    }

    /** 指针缓存（已脱离文档 / 不在正文里就作废，避免拿到过期节点） */
    _pointerCached() {
        const p = this._pointer;
        if (!p || !p.el || p.el.isConnected === false) {
            return null;
        }
        if (p.el.closest && !(p.el.closest(".protyle-wysiwyg") || p.el.closest(".protyle-title"))) {
            return null;
        }
        return p;
    }

    /**
     * 指针当前压着的元素 + 来源。
     * source：selector（?at= 指定）｜hover（:hover 链末端）｜cache（最后一次真实 hover）
     */
    _mouseHit(selector) {
        if (selector) {
            let el = null;
            try {
                el = typeof document.querySelector === "function" ? document.querySelector(selector) : null;
            } catch (e) {
                el = null;
            }
            return {el, source: "selector"};
        }
        if (typeof document.querySelectorAll === "function") {
            const chain = Array.from(document.querySelectorAll(":hover"));
            if (chain.length) {
                return {el: chain[chain.length - 1], source: "hover"};
            }
        }
        const cached = this._pointerCached();
        if (cached) {
            return {el: cached.el, source: "cache", ageMs: Date.now() - cached.ts};
        }
        return {el: null, source: "none"};
    }

    /** 指针当前压着的元素（原样，不做语义收敛） */
    _mouseElement(selector) {
        return this._mouseHit(selector).el;
    }

    /**
     * 把指针命中的「最内层节点」收敛成有意义的行元素。
     *
     * 指针经常压在装饰层上：公式里的 KaTeX 排版碎片（<span class="mord">）、
     * 图标 <svg><use>、拖拽手柄等。直接返回这些节点，行元素 HTML 就是一段
     * 残缺片段（公式上尤其明显）。
     * 收敛顺序：
     *   1) svg 内部 → 跳到 svg 的宿主元素
     *   2) 公式内部 → 回到公式宿主 span[data-type=inline-math] / div[data-type=NodeMathBlock]
     *   3) 有 data-type → 直接认（a / text / inline-math …）
     *   4) 非 span 的行内语义标签（strong / em / code …）→ 直接认
     *   5) 其余逐层上收，最多 12 层，到块元素为止
     */
    _normalizeLine(el, blockEl) {
        if (!el) {
            return null;
        }
        let node = el;
        // 1) SVG 内部（图标、公式的 <use>/<path>）：跳到 svg 的宿主元素
        if (node.ownerSVGElement) {
            const svg = node.ownerSVGElement;
            node = svg.parentElement || svg;
        }
        // 2) 公式内部：KaTeX 的 span 嵌套很深，统一回到公式宿主
        if (node.closest) {
            const host = node.closest(MATH_HOST_SELECTOR);
            if (host) {
                return host;
            }
        }
        // 3)~5) 逐层上收
        for (let i = 0; i < 12 && node; i++) {
            if (node.getAttribute && node.getAttribute("data-type")) {
                return node;
            }
            const tag = node.tagName ? String(node.tagName).toUpperCase() : "";
            if (tag && tag !== "SPAN" && INLINE_LINE_TAGS.has(tag)) {
                return node;
            }
            // 文本容器（contenteditable 的 div）就是行元素的天然边界，别再往上爬到整块
            if (node.getAttribute && node.getAttribute("contenteditable") === "true") {
                return node;
            }
            if (!node.parentElement || node === blockEl || node.parentElement === blockEl) {
                break;
            }
            // 到正文根就停：再往上就是 protyle / layout，会爬到 tab、窗口这类无关节点
            if (node.classList && (node.classList.contains("protyle-wysiwyg") ||
                node.classList.contains("protyle-title"))) {
                break;
            }
            node = node.parentElement;
        }
        return node || el;
    }

    /** 鼠标处的上下文：行元素 / 块元素 / 文档标题元素，全是真 DOM */
    _resolveMouse(selector) {
        const hit = this._mouseHit(selector);
        const ctx = this._buildMouseCtx(hit);
        if (ctx) {
            return ctx;
        }
        // 指针停在编辑器空白 / 侧栏（不属于任何块）时，退回最后一次真实落在块上的位置
        if (!selector) {
            const cached = this._pointerCached();
            if (cached) {
                return this._buildMouseCtx({el: cached.el, source: "cache", ageMs: Date.now() - cached.ts});
            }
        }
        return null;
    }

    /** 由一次「指针命中」构造完整上下文；命中的不是块就返回 null */
    _buildMouseCtx(hit) {
        const el = hit.el;
        if (!el) {
            return null;
        }
        const root = (el.closest && el.closest(".protyle-wysiwyg")) ||
            (el.closest && el.closest(".protyle-title")) || null;
        const protyleEl = root && root.closest ? root.closest(".protyle") : null;
        const titleEl = protyleEl && protyleEl.querySelector ? protyleEl.querySelector(".protyle-title") : null;
        const found = resolveBlock(el);
        let blockEl = found.blockEl;
        if (!blockEl) {
            // 标题区：.protyle-title 不在 .protyle-wysiwyg 里，单独兜底
            blockEl = (el.closest && el.closest(".protyle-title")) ||
                (titleEl && titleEl.contains && titleEl.contains(el) ? titleEl : null);
        }
        if (!blockEl) {
            // 指针在编辑器空白 / 侧栏这类不属于任何块的位置：宁可不给，也不给错
            return null;
        }
        return {
            el,
            hitEl: el,
            source: hit.source,
            ageMs: hit.ageMs,
            root,
            blockEl,
            innerEl: found.innerEl,
            cellEl: found.cellEl,
            // 行元素必须做语义收敛：指针可能压在公式排版碎片 / 图标 svg 上
            lineEl: this._normalizeLine(el, blockEl) || el,
            titleEl,
            inProtyle: !!(root || blockEl),
        };
    }

    /** 取不到鼠标处时的诊断信息（帮用户判断是「指针不在窗口上」还是「插件没生效」） */
    _mouseDiag() {
        let hoverCount = 0;
        try {
            hoverCount = typeof document.querySelectorAll === "function"
                ? document.querySelectorAll(":hover").length : 0;
        } catch (e) {
            hoverCount = -1;
        }
        const cached = this._pointerCached();
        return {
            hoverCount,
            hasPointerCache: !!cached,
            pointerAgeMs: cached ? Date.now() - cached.ts : null,
            hasFocus: typeof document !== "undefined" && document.hasFocus ? document.hasFocus() : null,
        };
    }

    /** 鼠标处的块元素（真 DOM，可直接 querySelector / 改属性） */
    getMouseBlockElement(selector) {
        const ctx = this._resolveMouse(selector);
        return ctx ? ctx.blockEl : null;
    }

    /** 鼠标处的行元素（真 DOM）：指针压着的 <span> / <strong> / <div class="p"> 等 */
    getMouseLineElement(selector) {
        const ctx = this._resolveMouse(selector);
        return ctx ? ctx.lineEl : null;
    }

    /** 鼠标处块元素的 outerHTML */
    getMouseBlockHTML(selector) {
        const el = this.getMouseBlockElement(selector);
        return el && typeof el.outerHTML === "string" ? el.outerHTML : null;
    }

    /** 鼠标处行元素的 outerHTML */
    getMouseLineHTML(selector) {
        const el = this.getMouseLineElement(selector);
        return el && typeof el.outerHTML === "string" ? el.outerHTML : null;
    }

    /**
     * 鼠标处的完整信息：字段与 getCursorInfo 对齐（blockId / docId / blockHTML / lineHTML…），
     * 另加 inProtyle（是否在正文里）与 source。
     * options.html === false 不生成 HTML；options.at 传 CSS 选择器可绕过鼠标。
     */
    getMouseInfo(options) {
        const opt = options || {};
        const withHtml = opt.html !== false;
        const ctx = this._resolveMouse(opt.at);
        if (!ctx) {
            return null;
        }
        const {el, blockEl, lineEl, cellEl, innerEl, titleEl, source, ageMs} = ctx;
        const chain = [];
        for (let p = lineEl; p && p !== blockEl; p = p.parentElement) {
            const cls = typeof p.className === "string" && p.className.trim()
                ? "." + p.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
            chain.unshift(String(p.tagName || p.nodeName || "").toLowerCase() + cls);
        }
        return {
            source,
            pointerAgeMs: typeof ageMs === "number" ? ageMs : null,
            // 指针实际压在哪个节点上（收敛前的原始命中，排查「为什么行元素是它」用）
            hit: {
                tag: el && el.tagName ? el.tagName.toLowerCase() : null,
                className: el && typeof el.className === "string" ? el.className : null,
                dataType: el && el.getAttribute ? (el.getAttribute("data-type") || null) : null,
            },
            // 行元素被上收到块元素本身（块级公式、整块命中时会出现）
            lineIsBlock: !!(lineEl && blockEl && lineEl === blockEl),
            inProtyle: ctx.inProtyle,
            blockId: blockEl ? blockEl.getAttribute("data-node-id") : null,
            blockType: blockEl ? blockEl.getAttribute("data-type") : null,
            blockClass: blockEl ? blockEl.className : null,
            blockText: blockEl ? (blockEl.textContent || "").replace(/\u200b/g, "").trim().slice(0, 200) : null,
            docId: titleEl ? titleEl.getAttribute("data-node-id") : null,
            docTitle: titleEl ? (titleEl.textContent || "").trim() : null,
            element: {
                tag: lineEl ? lineEl.tagName : null,
                className: lineEl ? (lineEl.className || null) : null,
                dataType: lineEl ? (lineEl.getAttribute("data-type") || null) : null,
                chain: chain.join(" > "),
            },
            lineTag: lineEl ? lineEl.tagName.toLowerCase() : null,
            lineClass: lineEl && typeof lineEl.className === "string" ? lineEl.className : null,
            lineHTML: withHtml && lineEl && typeof lineEl.outerHTML === "string" ? lineEl.outerHTML : null,
            blockHTML: withHtml && blockEl && typeof blockEl.outerHTML === "string" ? blockEl.outerHTML : null,
            // 表格特例与光标版一致：块是 NodeTable，单元格单独给
            inTable: !!cellEl,
            cell: cellBrief(cellEl, withHtml),
            innerBlockId: innerEl && blockEl && innerEl !== blockEl
                ? innerEl.getAttribute("data-node-id") : null,
        };
    }

    /**
     * 一次给出「块 + 行 + 祖先链 + 光标位置」，全部是纯数据，可直接 JSON 化。
     * block.html / line.html 都是完整 outerHTML。
     */
    getDomInfo() {
        const ctx = this._resolveContext();
        if (!ctx) {
            return null;
        }
        const {blockEl, lineEl, cellEl, range, source} = ctx;
        const ancestors = [];
        for (let el = lineEl; el && el !== blockEl; el = el.parentElement) {
            ancestors.push(domBrief(el, false));
        }
        return {
            source,
            block: domBrief(blockEl, true),
            line: domBrief(lineEl, true),
            cell: cellBrief(cellEl, true),
            ancestors,
            cursor: {
                offset: range.startOffset,
                collapsed: range.collapsed,
                selectedText: range.toString().slice(0, 200),
            },
        };
    }

    /**
     * 取「当前」块 / 元素信息。
     * options.html === false 时不生成 HTML（省开销），默认带。
     */
    getCursorInfo(options) {
        const opt = options || {};
        const withHtml = opt.html !== false;
        const ctx = this._resolveContext();
        if (!ctx) {
            return null;
        }
        const {range, blockEl, lineEl, titleEl, source, cellEl, innerEl} = ctx;

        const chain = [];
        for (let el = lineEl; el && el !== blockEl; el = el.parentElement) {
            chain.unshift(el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""));
        }

        return {
            source,
            blockId: blockEl ? blockEl.getAttribute("data-node-id") : null,
            blockType: blockEl ? blockEl.getAttribute("data-type") : null,
            blockClass: blockEl ? blockEl.className : null,
            blockText: blockEl ? (blockEl.textContent || "").replace(/\u200b/g, "").trim().slice(0, 200) : null,
            docId: titleEl ? titleEl.getAttribute("data-node-id") : null,
            docTitle: titleEl ? (titleEl.textContent || "").trim() : null,
            element: {
                tag: lineEl ? lineEl.tagName : null,
                className: lineEl ? (lineEl.className || null) : null,
                dataType: lineEl ? (lineEl.getAttribute("data-type") || null) : null,
                chain: chain.join(" > "),
            },
            lineTag: lineEl ? lineEl.tagName.toLowerCase() : null,
            lineClass: lineEl && typeof lineEl.className === "string" ? lineEl.className : null,
            lineHTML: withHtml && lineEl && typeof lineEl.outerHTML === "string" ? lineEl.outerHTML : null,
            blockHTML: withHtml && blockEl && typeof blockEl.outerHTML === "string" ? blockEl.outerHTML : null,
            // 表格特例：块是 NodeTable，光标所在单元格单独给（含行列号与干净 HTML）
            inTable: !!cellEl,
            cell: cellBrief(cellEl, withHtml),
            // 单元格内那层 lite 编辑器的段落块（临时 ID，内核 blocks 表查不到，仅供定位）
            innerBlockId: innerEl && blockEl && innerEl !== blockEl
                ? innerEl.getAttribute("data-node-id") : null,
            offset: range.startOffset,
            collapsed: range.collapsed,
            selectedText: range.toString().slice(0, 200),
        };
    }

    /* ============================ HTTP 服务 ============================ */

    /** 裸 HTML 响应（/block、/line、/mouse/block、/mouse/line 共用） */
    _sendHtml(res, html) {
        const buf = Buffer.from(html, "utf-8");
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Content-Length": buf.length,
        });
        res.end(buf);
    }

    _startServer() {
        if (!http) {
            return Promise.resolve(false);
        }
        return new Promise((resolve) => {
            const host = this.config.allowRemote ? "0.0.0.0" : "127.0.0.1";
            const server = http.createServer((req, res) => this._handle(req, res));
            server.on("error", (err) => {
                this._running = false;
                const msg = err && err.code === "EADDRINUSE"
                    ? `端口 ${this.config.port} 已被占用`
                    : (err && err.message) || "启动失败";
                console.error("[jsbridge] server error:", err);
                showMessage(`[JS Bridge] ${msg}`, 6000, "error");
                resolve(false);
            });
            server.listen(this.config.port, host, () => {
                this._server = server;
                this._running = true;
                this._startedAt = Date.now();
                console.log(`[jsbridge] listening on http://${host}:${this.config.port}`);
                resolve(true);
            });
        });
    }

    _stopServer() {
        return new Promise((resolve) => {
            if (!this._server) {
                this._running = false;
                return resolve();
            }
            const server = this._server;
            this._server = null;
            this._running = false;
            try {
                server.close(() => resolve());
            } catch (e) {
                resolve();
            }
            setTimeout(resolve, 800);
        });
    }

    async _restartServer() {
        await this._stopServer();
        if (!this.config.enabled || !http) {
            return false;
        }
        return this._startServer();
    }

    _handle(req, res) {
        const send = (code, obj) => {
            let body;
            try {
                body = JSON.stringify(obj, null, 2);
            } catch (e) {
                // 兜底：返回值里有不可序列化的东西（循环引用等），不能把连接晾死
                body = JSON.stringify({
                    ok: false,
                    error: {message: "响应序列化失败：" + ((e && e.message) || String(e))},
                }, null, 2);
                code = 500;
            }
            res.writeHead(code, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token, Authorization",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Content-Length": Buffer.byteLength(body),
            });
            res.end(body);
        };

        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Token, Authorization",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            });
            return res.end();
        }

        let url;
        try {
            url = new URL(req.url, "http://127.0.0.1");
        } catch (e) {
            return send(400, {ok: false, error: {message: "bad url"}});
        }

        const auth = req.headers["x-bridge-token"] ||
            String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
            url.searchParams.get("token") || "";
        if (auth !== this.config.token) {
            return send(401, {ok: false, error: {message: "invalid token"}});
        }

        if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
            return send(200, {
                ok: true,
                name: this.name,
                version: (this.manifest && this.manifest.version) || this.config.version || "0.2.0",
                port: this.config.port,
                host: this.config.allowRemote ? "0.0.0.0" : "127.0.0.1",
                uptimeSec: Math.round((Date.now() - this._startedAt) / 1000),
                runs: this._runs,
                lastRun: this._lastRun,
                endpoints: [
                    "GET /health",
                    "GET /cursor        （含 blockHTML / lineHTML）",
                    "GET /dom           （块 + 行 + 祖先链）",
                    "GET /block         （只要整个块 HTML，text/plain）",
                    "GET /line          （只要当前行元素 HTML，text/plain）",
                    "GET /mouse         （鼠标处：blockId / docId / blockHTML / lineHTML）",
                    "GET /mouse/block   （鼠标处块 HTML，text/plain）",
                    "GET /mouse/line    （鼠标处行元素 HTML，text/plain）",
                    "POST /run",
                ],
            });
        }

        if (req.method === "GET" && url.pathname === "/cursor") {
            // 默认带 HTML；?html=0 只要元信息（块很大时省带宽）
            const info = this.getCursorInfo({html: url.searchParams.get("html") !== "0"});
            return send(info ? 200 : 404, info
                ? {ok: true, data: info}
                : {ok: false, error: {message: "no cursor：请先在正文里点一下"}});
        }

        if (req.method === "GET" && url.pathname === "/dom") {
            const info = this.getDomInfo();
            return send(info ? 200 : 404, info
                ? {ok: true, data: info}
                : {ok: false, error: {message: "no cursor：请先在正文里点一下"}});
        }

        if (req.method === "GET" && (url.pathname === "/mouse" || url.pathname === "/hover")) {
            // 鼠标处：块 ID、文档 ID、块 HTML、行元素 HTML；?html=0 只要元信息，?at=选择器 绕过鼠标
            const at = url.searchParams.get("at") || undefined;
            const info = this.getMouseInfo({
                html: url.searchParams.get("html") !== "0",
                at,
            });
            const msg = at
                ? `no mouse：选择器「${at}」没落到正文块上（可能没匹配到，或命中的是编辑器空白）`
                : "no mouse：指针不在正文块上（先把鼠标移到笔记文字上），或用 ?at=CSS选择器 指定元素";
            return send(info ? 200 : 404, info
                ? {ok: true, data: info}
                : {ok: false, error: {message: msg}, diag: this._mouseDiag()});
        }

        if (req.method === "GET" && (url.pathname === "/mouse/block" || url.pathname === "/mouse/line")) {
            const at = url.searchParams.get("at") || undefined;
            const html = url.pathname === "/mouse/block"
                ? this.getMouseBlockHTML(at) : this.getMouseLineHTML(at);
            if (html === null) {
                return send(404, {
                    ok: false,
                    error: {message: "no mouse：指针不在正文块上（先把鼠标移到笔记文字上），或用 ?at=CSS选择器 指定元素"},
                    diag: this._mouseDiag(),
                });
            }
            return this._sendHtml(res, html);
        }

        if (req.method === "GET" && (url.pathname === "/block" || url.pathname === "/line")) {
            const html = url.pathname === "/block" ? this.getBlockHTML() : this.getLineHTML();
            if (html === null) {
                return send(404, {ok: false, error: {message: "no cursor：请先在正文里点一下"}});
            }
            return this._sendHtml(res, html);
        }

        if (req.method === "POST" && (url.pathname === "/run" || url.pathname === "/eval")) {
            const maxBytes = Math.max(1, this.config.maxBodyKB) * 1024;
            let size = 0;
            const chunks = [];
            req.on("data", (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                    send(413, {ok: false, error: {message: `body 超过 ${this.config.maxBodyKB} KB`}});
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on("end", async () => {
                if (size > maxBytes) {
                    return;
                }
                let payload;
                const raw = Buffer.concat(chunks).toString("utf-8");
                const contentType = String(req.headers["content-type"] || "");
                if (contentType.includes("application/json")) {
                    try {
                        payload = JSON.parse(raw);
                    } catch (e) {
                        return send(400, {ok: false, error: {message: "JSON 解析失败：" + e.message}});
                    }
                } else {
                    payload = {code: raw};
                }
                if (!payload || typeof payload !== "object") {
                    payload = {code: String(payload || "")};
                }
                const code = payload.code || payload.script || "";
                if (!code || !String(code).trim()) {
                    return send(400, {ok: false, error: {message: "缺少 code / script 字段"}});
                }
                let result;
                try {
                    result = await this._enqueue(String(code), {
                        timeoutMs: Number(payload.timeoutMs) || this.config.timeoutMs,
                        vars: payload.vars || {},
                    });
                } catch (e) {
                    result = {ok: false, error: {message: (e && e.message) || String(e)}, logs: [], durationMs: 0};
                }
                return send(result.ok ? 200 : 500, result);
            });
            return;
        }

        return send(404, {ok: false, error: {message: "unknown endpoint", path: url.pathname}});
    }

    /* ============================ 执行 ============================ */

    /** 串行执行，避免并发脚本互相踩 console 与编辑器状态 */
    _enqueue(code, options) {
        const run = () => this._execute(code, options);
        const task = this._queue.then(run, run);
        this._queue = task.then(() => undefined, () => undefined);
        return task;
    }

    async _execute(code, options) {
        const opt = options || {};
        const started = Date.now();
        const logs = [];
        const capture = (...args) => {
            logs.push(args.map(fmt).join(" "));
            if (logs.length > 500) {
                logs.shift();
            }
        };
        const origLog = console.log;
        const origWarn = console.warn;
        const origError = console.error;
        console.log = capture;
        console.warn = (...a) => capture("[warn]", ...a);
        console.error = (...a) => capture("[error]", ...a);

        let timer = null;
        try {
            const fn = new Function(
                "siyuan", "app", "plugin", "sleep", "waitFor", "log", "fetchSyncPost",
                "getCursor", "getBlockEl", "getLineEl", "getBlockHTML", "getLineHTML", "getDom",
                "getMouse", "getMouseBlockEl", "getMouseLineEl", "getMouseBlockHTML", "getMouseLineHTML",
                "vars", "console",
                `"use strict";\nreturn (async () => {\n${code}\n})();`,
            );
            const api = require("siyuan");
            const consoleShim = {log: capture, info: capture, warn: capture, error: capture, debug: capture};
            const exec = fn(
                api, this.app, this, sleep, waitFor,
                (...a) => capture(...a),
                fetchSyncPost,
                this._cursorLazy(),
                () => this.getBlockElement(),
                () => this.getLineElement(),
                () => this.getBlockHTML(),
                () => this.getLineHTML(),
                () => this.getDomInfo(),
                (opt) => this.getMouseInfo(opt),
                (sel) => this.getMouseBlockElement(sel),
                (sel) => this.getMouseLineElement(sel),
                (sel) => this.getMouseBlockHTML(sel),
                (sel) => this.getMouseLineHTML(sel),
                opt.vars || {},
                consoleShim,
            );
            const timeoutMs = Math.max(1000, opt.timeoutMs || this.config.timeoutMs);
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`执行超时（${timeoutMs} ms）`)), timeoutMs);
            });
            const value = await Promise.race([exec, timeout]);
            const durationMs = Date.now() - started;
            this._runs++;
            this._lastRun = {at: new Date().toISOString(), ok: true, durationMs, bytes: code.length};
            return {ok: true, result: sanitize(value, 0), logs, durationMs};
        } catch (error) {
            const durationMs = Date.now() - started;
            this._runs++;
            this._lastRun = {at: new Date().toISOString(), ok: false, durationMs, bytes: code.length};
            return {
                ok: false,
                error: {
                    name: error && error.name,
                    message: (error && error.message) || String(error),
                    stack: error && error.stack,
                },
                logs,
                durationMs,
            };
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
            console.log = origLog;
            console.warn = origWarn;
            console.error = origError;
        }
    }

    /* ============================ 界面 ============================ */

    _addUI() {
        const t = (key, fallback) => {
            try {
                return this.i18n && this.i18n[key] ? this.i18n[key] : fallback;
            } catch (e) {
                return fallback;
            }
        };
        this._t = t;

        this._topBarEl = this.addTopBar({
            icon: "iconSparkles",
            title: t("title", "JS Bridge"),
            position: "right",
            callback: () => this._showMenu(),
        });
        this._refreshTopBar();

        this.addCommand({
            langKey: "runSnippet",
            hotkey: "⇧⌘J",
            callback: () => this._showRunner(),
        });
        this.addCommand({
            langKey: "copyToken",
            callback: async () => {
                await navigator.clipboard.writeText(this.config.token);
                showMessage(t("tokenCopied", "令牌已复制"));
            },
        });

        this._buildSetting();
    }

    _refreshTopBar() {
        if (!this._topBarEl) {
            return;
        }
        const on = this._running;
        this._topBarEl.style.opacity = on ? "1" : "0.45";
        this._topBarEl.title = on
            ? `JS Bridge · 运行中 · 127.0.0.1:${this.config.port}`
            : "JS Bridge · 未启动";
    }

    _showMenu() {
        const t = this._t;
        const menu = new Menu("jsbridge");
        menu.addItem({
            icon: this._running ? "iconRecord" : "iconPause",
            label: this._running
                ? t("statusOn", `运行中 · 127.0.0.1:${this.config.port}`)
                : t("statusOff", "未启动"),
            disabled: true,
        });
        menu.addItem({
            icon: "iconCopy",
            label: t("copyUrl", "复制地址"),
            click: async () => {
                await navigator.clipboard.writeText(`http://127.0.0.1:${this.config.port}/run`);
                showMessage(t("urlCopied", "地址已复制"));
            },
        });
        menu.addItem({
            icon: "iconKey",
            label: t("copyToken", "复制令牌"),
            click: async () => {
                await navigator.clipboard.writeText(this.config.token);
                showMessage(t("tokenCopied", "令牌已复制"));
            },
        });
        menu.addSeparator();
        menu.addItem({
            icon: "iconTerminal",
            label: t("runner", "运行 JS 片段…"),
            click: () => this._showRunner(),
        });
        menu.addItem({
            icon: "iconSettings",
            label: t("settings", "设置"),
            click: () => this.setting && this.setting.open(),
        });
        menu.addItem({
            icon: "iconRefresh",
            label: t("restart", "重启服务"),
            click: async () => {
                const ok = await this._restartServer();
                this._refreshTopBar();
                showMessage(ok ? t("restarted", "已重启") : t("restartFail", "重启失败，看控制台"));
            },
        });
        menu.fullscreen();
    }

    _showRunner() {
        const t = this._t;
        const dialog = new Dialog({
            title: t("runner", "运行 JS 片段"),
            content: `<div class="b3-dialog__content">
  <div class="jsb-hint">可用变量：<code>siyuan</code> <code>app</code> <code>plugin</code> <code>getCursor()</code> <code>getBlockEl()</code> <code>getLineEl()</code> <code>getBlockHTML()</code> <code>getLineHTML()</code> <code>getDom()</code> <code>getMouse()</code> <code>getMouseBlockHTML()</code> <code>getMouseLineHTML()</code> <code>fetchSyncPost</code> <code>sleep</code> <code>waitFor</code> <code>log</code> <code>vars</code>；支持 <code>await</code> 与 <code>return</code>。</div>
  <textarea class="b3-text-field fn__block jsb-code" spellcheck="false">const d = getDom();
return {blockId: d && d.block.nodeId, blockHTML: d && d.block.html, lineHTML: d && d.line.html};</textarea>
  <div class="fn__hr"></div>
  <button class="b3-button b3-button--outline" id="jsbRun">${t("run", "运行")}</button>
  <div class="fn__hr"></div>
  <pre class="jsb-out" id="jsbOut">${t("ready", "就绪")}</pre>
</div>`,
            width: this.isMobile ? "92vw" : "720px",
            height: "560px",
        });
        const ta = dialog.element.querySelector(".jsb-code");
        const out = dialog.element.querySelector("#jsbOut");
        dialog.element.querySelector("#jsbRun").addEventListener("click", async () => {
            out.textContent = "…";
            const r = await this._enqueue(ta.value, {});
            out.textContent = JSON.stringify(r, null, 2);
        });
    }

    _buildSetting() {
        const t = this._t;
        const inpPort = document.createElement("input");
        inpPort.className = "b3-text-field fn__flex-center jsb-port";
        inpPort.type = "number";
        inpPort.min = "1024";
        inpPort.max = "65535";
        inpPort.style.width = "110px";
        inpPort.value = String(this.config.port);

        const inpToken = document.createElement("input");
        inpToken.className = "b3-text-field fn__flex-1 jsb-token";
        inpToken.value = this.config.token;

        const btnNew = document.createElement("button");
        btnNew.className = "b3-button b3-button--outline fn__flex-center";
        btnNew.textContent = t("regenerate", "重新生成");
        btnNew.addEventListener("click", () => {
            inpToken.value = randToken();
        });

        const inpRemote = document.createElement("input");
        inpRemote.type = "checkbox";
        inpRemote.className = "b3-switch fn__flex-center jsb-remote";
        inpRemote.checked = !!this.config.allowRemote;

        const inpTimeout = document.createElement("input");
        inpTimeout.className = "b3-text-field fn__flex-center jsb-timeout";
        inpTimeout.type = "number";
        inpTimeout.min = "1000";
        inpTimeout.max = "600000";
        inpTimeout.step = "1000";
        inpTimeout.style.width = "120px";
        inpTimeout.value = String(this.config.timeoutMs);

        const statusEl = document.createElement("span");
        statusEl.className = "jsb-status";
        const refreshStatus = () => {
            statusEl.textContent = this._running
                ? `${t("statusOn", "运行中")} · http://127.0.0.1:${this.config.port}/run`
                : t("statusOff", "未启动");
            statusEl.style.color = this._running ? "var(--b3-theme-primary)" : "var(--b3-theme-error)";
        };
        refreshStatus();
        const btnTest = document.createElement("button");
        btnTest.className = "b3-button b3-button--outline fn__flex-center";
        btnTest.textContent = t("test", "测试");
        btnTest.addEventListener("click", async () => {
            const r = await this._enqueue("return {pong: true, cursor: getCursor()};", {});
            showMessage(r.ok ? "OK：" + JSON.stringify(r.result).slice(0, 160) : "失败：" + r.error.message, 6000, r.ok ? "" : "error");
        });

        this.setting = new Setting({
            confirmCallback: async () => {
                const port = Math.min(65535, Math.max(1024, parseInt(inpPort.value, 10) || DEFAULTS.port));
                this.config.port = port;
                this.config.token = inpToken.value.trim() || randToken();
                this.config.allowRemote = inpRemote.checked;
                this.config.timeoutMs = Math.min(600000, Math.max(1000, parseInt(inpTimeout.value, 10) || DEFAULTS.timeoutMs));
                this.config.enabled = true;
                await this.saveData(CONF, this.config);
                await this._restartServer();
                refreshStatus();
                this._refreshTopBar();
                showMessage(t("saved", "已保存并重启服务"));
            },
        });

        this.setting.addItem({
            title: t("port", "端口"),
            description: t("portDesc", "只监听 127.0.0.1；改完点「确定」生效"),
            direction: "row",
            createActionElement: () => inpPort,
        });
        this.setting.addItem({
            title: t("token", "访问令牌"),
            description: t("tokenDesc", "请求头 X-Bridge-Token，或 ?token=xxx"),
            direction: "column",
            createActionElement: () => {
                const wrap = document.createElement("div");
                wrap.className = "fn__flex";
                wrap.append(inpToken, btnNew);
                return wrap;
            },
        });
        this.setting.addItem({
            title: t("allowRemote", "允许非本机访问"),
            description: t("allowRemoteDesc", "危险：会把任意代码执行能力暴露到局域网，确认有必要再开"),
            direction: "row",
            createActionElement: () => inpRemote,
        });
        this.setting.addItem({
            title: t("timeout", "执行超时（毫秒）"),
            description: t("timeoutDesc", "只对异步代码有效；死循环仍会卡住渲染进程"),
            direction: "row",
            createActionElement: () => inpTimeout,
        });
        this.setting.addItem({
            title: t("status", "状态"),
            direction: "row",
            createActionElement: () => {
                const wrap = document.createElement("div");
                wrap.className = "fn__flex";
                wrap.style.gap = "8px";
                wrap.style.alignItems = "center";
                wrap.append(statusEl, btnTest);
                return wrap;
            },
        });
    }
};
