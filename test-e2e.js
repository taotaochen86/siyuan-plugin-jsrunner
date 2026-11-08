// 端到端测试：用假 siyuan 模块加载插件，真的起 HTTP 服务，真的发请求
// 覆盖：鉴权、GET /health、GET /cursor（含选区记忆）、POST /run（返回值/日志/错误/超时/并发串行）
const http = require("http");
const path = require("path");
const Module = require("module");

// ---------- 1. 假 siyuan 模块 ----------
const noop = () => {};
class Plugin {
    constructor(options) {
        Object.assign(this, options || {});
        this.name = (options && options.name) || "siyuan-plugin-jsbridge";
        this._data = {};
        this.i18n = (options && options.i18n) || {};
    }
    async loadData() { return this._data; }
    async saveData(key, value) { this._data = value; }
    addTopBar() { return { style: {}, title: "" }; }
    addCommand() { return { addCommand: noop }; }
    addDock() { return {}; }
}
class Setting {
    constructor(o) { this.o = o; }
    addItem() {}
    open() {}
    close() {}
}
class Menu { constructor() {} addItem() {} addSeparator() {} fullscreen() {} }
class Dialog { constructor(o) { this.element = { querySelector: () => null }; } }
const showMessage = noop;
const fetchSyncPost = async () => ({ code: 0, data: {} });

const fakeSiYuan = {Plugin, Setting, Menu, Dialog, showMessage, fetchSyncPost};

// 拦截 require("siyuan")
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === "siyuan") {
        return "siyuan";
    }
    return origResolve.call(this, request, ...rest);
};
require.cache["siyuan"] = {id: "siyuan", filename: "siyuan", loaded: true, exports: fakeSiYuan};

// ---------- 2. 假 DOM ----------
// 一个 .protyle-wysiwyg，里面两个段落块
function makeNode(value, parent) {
    const node = {
        nodeType: 3, nodeValue: value, parentElement: parent,
        childNodes: [], isConnected: true,
    };
    return node;
}

const wysiwyg = {
    classList: {contains: (c) => c === "protyle-wysiwyg"},
    contains: () => true,
    closest: () => null,
    querySelector: () => null,
    childNodes: [],
};
const p1text = makeNode("第一段示例文本", null);

// 光标落在 <strong> 里的场景：用来验证「块 HTML」和「行元素 HTML」不是同一个东西
const strongText = makeNode("加粗片段", null);
const strongEl = {
    nodeType: 1, tagName: "STRONG", className: "", childNodes: [strongText],
    parentElement: null, isConnected: true,
    hasAttribute: () => false,
    getAttribute: () => null,
    classList: {contains: () => false},
    closest: (sel) => (sel === ".protyle-wysiwyg" ? wysiwyg : null),
    outerHTML: '<strong>加粗片段</strong>',
};
strongText.parentElement = strongEl;

const P1_OUTER = '<div data-node-id="20261004111715-01xuh9w" data-type="NodeParagraph" class="p"><div contenteditable="true">第一段示例文本<strong>加粗片段</strong></div><div class="protyle-attr">\u200b</div></div>';

const p1 = {
    nodeType: 1, tagName: "DIV", className: "p", childNodes: [p1text, strongEl],
    parentElement: wysiwyg, isConnected: true,
    hasAttribute: () => true,
    getAttribute: (k) => ({ "data-node-id": "20261004111715-01xuh9w", "data-type": "NodeParagraph" }[k] || null),
    classList: {contains: () => false},
    // 段落块向上找正文根 → wysiwyg（DOM 里 .p 的直接父节点就是 .protyle-wysiwyg）
    closest: (sel) => (sel === ".protyle-wysiwyg" ? wysiwyg : null),
    outerHTML: P1_OUTER,
    textContent: "第一段示例文本加粗片段",
};
p1text.parentElement = p1;
strongEl.parentElement = p1;
wysiwyg.childNodes = [p1];

// ---------- 表格：块是 NodeTable，内容渲染在单元格的 lite 编辑器里 ----------
// 结构：div[NodeTable] > table > tbody > tr > td > div.table__cell-editor > div.protyle-wysiwyg > div.p
function mkEl(opts) {
    const el = {
        nodeType: 1,
        tagName: opts.tag.toUpperCase(),
        className: opts.cls || "",
        childNodes: [],
        parentElement: opts.parent || null,
        isConnected: true,
        textContent: opts.text || "",
        outerHTML: opts.html || `<${opts.tag.toLowerCase()}>${opts.text || ""}</${opts.tag.toLowerCase()}>`,
        rowIndex: opts.rowIndex,
        cellIndex: opts.cellIndex,
    };
    el.classList = {contains: (c) => String(el.className).split(/\s+/).includes(c)};
    el.getAttribute = (k) => (opts.attrs && opts.attrs[k] != null ? opts.attrs[k] : null);
    el.hasAttribute = (k) => !!(opts.attrs && opts.attrs[k] != null);
    el.contains = (n) => {
        for (let x = n; x; x = x.parentElement) {
            if (x === el) {
                return true;
            }
        }
        return false;
    };
    el.closest = (sel) => {
        // 支持逗号列表 + [attr=value]，插件里用到 [data-type="inline-math"], [data-type="NodeMathBlock"]
        const parts = String(sel).split(",").map((s) => s.trim()).filter(Boolean);
        for (let x = el; x; x = x.parentElement) {
            for (const want of parts) {
                if (want.startsWith(".")) {
                    if (x.classList && x.classList.contains(want.slice(1))) {
                        return x;
                    }
                } else if (want.startsWith("[")) {
                    const m = /^\[([^\]=]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(want);
                    const val = m && x.getAttribute ? x.getAttribute(m[1]) : null;
                    if (m && val != null && (m[2] === undefined || val === m[2])) {
                        return x;
                    }
                } else if (String(x.tagName || "").toLowerCase() === want.toLowerCase()) {
                    return x;
                }
            }
        }
        return null;
    };
    el.querySelector = () => null;
    el.querySelectorAll = () => [];
    el.cloneNode = () => el;
    return el;
}

const TABLE_OUTER = '<div data-node-id="20241117120219-w1ptehx" data-type="NodeTable" class="table"><div contenteditable="false"><table><tbody><tr><td><div class="table__cell-editor"><div class="protyle-wysiwyg"><div data-node-id="20261022174156-icgusys" data-type="NodeParagraph" class="p">单元格文字</div></div></div></td></tr></tbody></table></div></div>';

const tableBlock = mkEl({
    tag: "div", cls: "table", parent: wysiwyg, text: "单元格文字",
    attrs: {"data-node-id": "20241117120219-w1ptehx", "data-type": "NodeTable"},
    html: TABLE_OUTER,
});
const tblTable = mkEl({tag: "table", parent: tableBlock});
const tblBody = mkEl({tag: "tbody", parent: tblTable});
const tblRow = mkEl({tag: "tr", parent: tblBody, rowIndex: 0});
const tblCell = mkEl({tag: "td", parent: tblRow, cellIndex: 1, text: "单元格文字"});
const cellEditor = mkEl({tag: "div", cls: "table__cell-editor protyle-lite-fragment", parent: tblCell});
const innerWysiwyg = mkEl({tag: "div", cls: "protyle-wysiwyg", parent: cellEditor, text: "单元格文字"});
const cellP = mkEl({
    tag: "div", cls: "p", parent: innerWysiwyg, text: "单元格文字",
    attrs: {"data-node-id": "20261022174156-icgusys", "data-type": "NodeParagraph"},
    html: '<div data-node-id="20261022174156-icgusys" data-type="NodeParagraph" class="p">单元格文字</div>',
});
const cellText = makeNode("单元格文字", cellP);
cellP.childNodes = [cellText];
innerWysiwyg.childNodes = [cellP];
tableBlock.childNodes = [tblTable];
wysiwyg.childNodes = [p1, tableBlock];

// ---------- 公式：行级公式宿主 + 内部 KaTeX 碎片 ----------
const mathHost = mkEl({
    tag: "span", cls: "render-node", parent: p1, text: "y=x^2",
    attrs: {"data-type": "inline-math", "data-subtype": "math", "data-content": "y=x^2", "contenteditable": "false"},
    html: '<span data-type="inline-math" data-subtype="math" data-content="y=x^2" contenteditable="false" class="render-node"><span class="katex"><span class="mord mathnormal">y</span></span></span>',
});
const katexEl = mkEl({tag: "span", cls: "katex", parent: mathHost});
const mordEl = mkEl({tag: "span", cls: "mord mathnormal", parent: katexEl, text: "y"});
katexEl.childNodes = [mordEl];
mathHost.childNodes = [katexEl];

// 块级公式：整个 div 就是块，内部还有一层 KaTeX
const mathBlockOuter = '<div data-node-id="20260930132334-33pwqnx" data-type="NodeMathBlock" class="render-node" data-content="y=x^2"><div><span contenteditable="false"><span class="katex"><span class="mord">y</span></span></span></div></div>';
const mathBlock = mkEl({
    tag: "div", cls: "render-node", parent: wysiwyg, text: "y=x^2",
    attrs: {"data-node-id": "20260930132334-33pwqnx", "data-type": "NodeMathBlock", "data-content": "y=x^2"},
    html: mathBlockOuter,
});
const bmWrap = mkEl({tag: "div", parent: mathBlock});
const bmSpan = mkEl({tag: "span", parent: bmWrap});
const bmMord = mkEl({tag: "span", cls: "mord", parent: bmSpan, text: "y"});
bmSpan.childNodes = [bmMord];
bmWrap.childNodes = [bmSpan];
mathBlock.childNodes = [bmWrap];

const protyleTitle = {
    nodeType: 1, tagName: "DIV", isConnected: true,
    className: "protyle-title",
    classList: {contains: (c) => c === "protyle-title"},
    hasAttribute: () => true,
    getAttribute: (k) => (k === "data-node-id" ? "20261004111715-6yvbpv1" : (k === "data-type" ? "NodeDocument" : null)),
    textContent: "99 About",
    querySelector: () => null,
    contains: () => false,
    closest: (sel) => (sel === ".protyle" ? protyle : null),
    outerHTML: '<div class="protyle-title" data-node-id="20261004111715-6yvbpv1" data-type="NodeDocument"><span>99 About</span></div>',
};
const protyle = {
    nodeType: 1, tagName: "DIV", isConnected: true,
    getAttribute: () => null,
    querySelector: (sel) => (sel === ".protyle-title" ? protyleTitle : null),
};
wysiwyg.closest = (sel) => {
    if (sel === ".protyle-wysiwyg") {
        return wysiwyg;
    }
    if (sel === ".protyle") {
        return protyle;
    }
    return null;
};

const listeners = {};
// 测试里手工指定「指针压着的元素链」（真实环境由浏览器维护 :hover）
const hoverChain = [];
const atMap = {".p": p1, "strong": strongEl};
global.document = {
    // 插件用 ".protyle-wysiwyg, .protyle-title" 组合选择器（标题区也支持取块）
    querySelectorAll: (sel) => {
        if (String(sel) === ":hover") {
            return hoverChain;
        }
        const out = [];
        if (String(sel).includes(".protyle-wysiwyg")) {
            out.push(wysiwyg);
            // 表格单元格里还有一层 lite 编辑器的 wysiwyg，真实 DOM 里它也会被选中
            out.push(innerWysiwyg);
        }
        if (String(sel).includes(".protyle-title")) {
            out.push(protyleTitle);
        }
        return out;
    },
    querySelector: (sel) => atMap[String(sel).trim()] || null,
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: (type, fn) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    getSelection: () => docSelection,
    createRange: () => makeRange(null, 0),
    getElementById: () => null,
    createElement: () => ({ style: {}, append: noop, addEventListener: noop, classList: {add: noop} }),
    head: {append: noop},
};
global.window = {};

let docSelection = null;
const makeRange = (node, offset) => ({
    startContainer: node, endContainer: node,
    startOffset: offset, endOffset: offset,
    collapsed: true,
    cloneRange() { return makeRange(node, offset); },
    setStart(n, o) { this.startContainer = n; this.startOffset = o; this.endContainer = n; this.endOffset = o; },
    setEnd(n, o) { this.endContainer = n; this.endOffset = o; },
    toString: () => "",
});

// ---------- 3. 加载插件 ----------
const PluginClass = require(path.join(__dirname, "..", "siyuan-plugin-jsbridge", "index.js"));
const app = {plugins: [], workspaces: []};
const plugin = new PluginClass({app, name: "siyuan-plugin-jsbridge", displayName: "JS 桥", i18n: {}});

const results = [];
const expect = (name, cond, extra) => results.push({name, pass: !!cond, extra: extra === undefined ? "" : String(extra).slice(0, 160)});

function req(method, urlPath, {token, body, contentType} = {}) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : (typeof body === "string" ? body : JSON.stringify(body));
        const headers = {};
        if (data !== null) {
            headers["Content-Type"] = contentType || "application/json";
            headers["Content-Length"] = Buffer.byteLength(data);
        }
        if (token) {
            headers["X-Bridge-Token"] = token;
        }
        const r = http.request({host: "127.0.0.1", port: PORT, path: urlPath, method, headers}, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                let json;
                const raw = Buffer.concat(chunks).toString("utf-8");
                try {
                    json = JSON.parse(raw);
                } catch (e) {
                    json = {_raw: raw};
                }
                resolve({status: res.statusCode, json});
            });
        });
        r.on("error", reject);
        if (data !== null) {
            r.write(data);
        }
        r.end();
    });
}

const PORT = 16866;
const TOKEN = "test-token-1234567890";

(async () => {
    plugin.config = {
        enabled: true, port: PORT, token: "test-token-1234567890",
        allowRemote: false, timeoutMs: 2000, maxBodyKB: 64, logRuns: true,
    };
    plugin._server = null;
    plugin._running = false;
    plugin._startedAt = 0;
    plugin._runs = 0;
    plugin._lastRun = null;
    plugin._queue = Promise.resolve();
    plugin._mem = new WeakMap();
    plugin._installFocusMemory();
    plugin._installPointerMemory();

    const started = await plugin._startServer();
    expect("服务启动", started === true, `started=${started}`);
    if (!started) {
        printOut();
        return;
    }

    // --- 鉴权 ---
    let r = await req("GET", "/health");
    expect("无令牌被拒 401", r.status === 401, `status=${r.status}`);

    r = await req("GET", "/health?token=wrong");
    expect("错误令牌被拒", r.status === 401, `status=${r.status}`);

    r = await req("GET", "/health", {token: "test-token-1234567890"});
    expect("正确令牌通过 /health", r.status === 200 && r.json.ok === true, JSON.stringify(r.json).slice(0, 100));

    r = await req("GET", "/health?token=test-token-1234567890");
    expect("query 令牌可用", r.status === 200, `status=${r.status}`);

    // --- /cursor 无光标 ---
    r = await req("GET", "/cursor", {token: "test-token-1234567890"});
    expect("无光标返回 404", r.status === 404, `status=${r.status}`);

    // --- 真实选区 ---
    docSelection = {rangeCount: 1, getRangeAt: () => makeRange(p1text, 2)};
    // 真实浏览器里用户把光标点进正文就会触发 selectionchange，这里手动补一拍
    (listeners["selectionchange"] || []).forEach((fn) => fn());
    r = await req("GET", "/cursor", {token: "test-token-1234567890"});
    expect("真实选区能取到块 ID", r.json.data && r.json.data.blockId === "20261004111715-01xuh9w", r.json.data && r.json.data.blockId);
    expect("source 标记为 selection", r.json.data && r.json.data.source === "selection", r.json.data && r.json.data.source);

    // --- 模拟点侧栏：选区清空，走记忆 ---
    // 注意：真实浏览器里 selectionchange 是选区变化「之后」触发，此时旧 range 已失效；
    // 这里必须先把 docSelection 置空再触发，才等价于真实时序
    docSelection = {rangeCount: 0, getRangeAt: () => null};
    (listeners["selectionchange"] || []).forEach((fn) => fn());
    r = await req("GET", "/cursor", {token: "test-token-1234567890"});
    expect("点侧栏后仍能取到（记忆选区）", r.json.data && r.json.data.blockId === "20261004111715-01xuh9w", r.json.data && r.json.data.blockId);
    expect("source 标记为 memory", r.json.data && r.json.data.source === "memory", r.json.data && r.json.data.source);

    // --- DOM 输出：整个块 HTML / 当前行元素 HTML ---
    // 把光标挪进 <strong>，验证「块」和「行元素」确实是两层不同的 DOM
    docSelection = {rangeCount: 1, getRangeAt: () => makeRange(strongText, 1)};
    (listeners["selectionchange"] || []).forEach((fn) => fn());

    r = await req("GET", "/cursor", {token: TOKEN});
    expect("/cursor 返回整个块 blockHTML", r.json.data && r.json.data.blockHTML === P1_OUTER,
        String((r.json.data && r.json.data.blockHTML) || "null").slice(0, 80));
    expect("/cursor 返回当前行元素 lineHTML（strong）", r.json.data && r.json.data.lineHTML === strongEl.outerHTML,
        String((r.json.data && r.json.data.lineHTML) || "null"));
    expect("/cursor 块与行是两层不同 DOM", r.json.data && r.json.data.blockHTML !== r.json.data.lineHTML);
    expect("/cursor lineTag = strong", r.json.data && r.json.data.lineTag === "strong", r.json.data && r.json.data.lineTag);

    r = await req("GET", "/cursor?html=0", {token: TOKEN});
    expect("/cursor?html=0 不带 HTML", r.json.data && r.json.data.blockHTML === null && r.json.data.lineHTML === null);
    expect("/cursor?html=0 仍保留 blockId", r.json.data && r.json.data.blockId === "20261004111715-01xuh9w");

    r = await req("GET", "/dom", {token: TOKEN});
    expect("/dom 返回 block.html", r.json.data && r.json.data.block && r.json.data.block.html === P1_OUTER);
    expect("/dom 返回 line.html", r.json.data && r.json.data.line && r.json.data.line.html === strongEl.outerHTML);
    expect("/dom 返回祖先链（strong）", r.json.data && r.json.data.ancestors.length === 1 && r.json.data.ancestors[0].tag === "strong",
        JSON.stringify(r.json.data && r.json.data.ancestors));
    expect("/dom 返回光标偏移", r.json.data && r.json.data.cursor && r.json.data.cursor.offset === 1);

    r = await req("GET", "/block", {token: TOKEN});
    expect("/block 返回 text/html 裸 HTML", r.status === 200 && r.json._raw === P1_OUTER, String(r.json._raw || "").slice(0, 60));

    r = await req("GET", "/line", {token: TOKEN});
    expect("/line 返回行元素 HTML", r.status === 200 && r.json._raw === strongEl.outerHTML, String(r.json._raw || ""));

    // --- /mouse：鼠标处（:hover 链） ---
    hoverChain.length = 0;
    r = await req("GET", "/mouse", {token: TOKEN});
    expect("/mouse 指针不在正文时 404", r.status === 404 && /no mouse/.test(r.json.error && r.json.error.message), String(r.status));

    hoverChain.push(p1, strongEl);   // 指针压在 <strong> 上
    r = await req("GET", "/mouse", {token: TOKEN});
    expect("/mouse 块 ID", r.json.data && r.json.data.blockId === "20261004111715-01xuh9w", r.json.data && r.json.data.blockId);
    expect("/mouse 块类型", r.json.data && r.json.data.blockType === "NodeParagraph", r.json.data && r.json.data.blockType);
    expect("/mouse 文档 ID", r.json.data && r.json.data.docId === "20261004111715-6yvbpv1", r.json.data && r.json.data.docId);
    expect("/mouse 文档标题", r.json.data && r.json.data.docTitle === "99 About", r.json.data && r.json.data.docTitle);
    expect("/mouse 块 HTML = 整段", r.json.data && r.json.data.blockHTML === P1_OUTER);
    expect("/mouse 行 HTML = strong", r.json.data && r.json.data.lineHTML === strongEl.outerHTML, r.json.data && r.json.data.lineHTML);
    expect("/mouse lineTag = strong", r.json.data && r.json.data.lineTag === "strong", r.json.data && r.json.data.lineTag);
    expect("/mouse inProtyle = true", r.json.data && r.json.data.inProtyle === true);
    expect("/mouse source = hover", r.json.data && r.json.data.source === "hover", r.json.data && r.json.data.source);

    r = await req("GET", "/mouse?html=0", {token: TOKEN});
    expect("/mouse?html=0 不带 HTML", r.json.data && r.json.data.blockHTML === null && r.json.data.lineHTML === null);
    expect("/mouse?html=0 仍保留 blockId", r.json.data && r.json.data.blockId === "20261004111715-01xuh9w");

    r = await req("GET", "/mouse/line", {token: TOKEN});
    expect("/mouse/line 返回裸 HTML", r.status === 200 && r.json._raw === strongEl.outerHTML, String(r.json._raw || ""));

    r = await req("GET", "/mouse/block", {token: TOKEN});
    expect("/mouse/block 返回整块 HTML", r.status === 200 && r.json._raw === P1_OUTER, String(r.json._raw || "").slice(0, 60));

    // ?at= 绕过鼠标（指针不在正文时也能取指定元素）
    hoverChain.length = 0;
    r = await req("GET", "/mouse?at=" + encodeURIComponent(".p"), {token: TOKEN});
    expect("/mouse?at= 绕过鼠标取到块", r.json.data && r.json.data.blockId === "20261004111715-01xuh9w"
        && r.json.data.source === "selector", JSON.stringify(r.json.data && r.json.data.source));
    expect("/mouse?at=.p 行元素=块元素", r.json.data && r.json.data.lineHTML === P1_OUTER);

    // --- 公式：行元素必须收敛到公式宿主，不能是 KaTeX 排版碎片 ---
    hoverChain.push(p1, mathHost, katexEl, mordEl);   // 指针压在行级公式的 mord 碎片上
    r = await req("GET", "/mouse", {token: TOKEN});
    expect("行级公式：行元素收敛到 inline-math 宿主",
        r.json.data && r.json.data.element.dataType === "inline-math" && r.json.data.lineHTML === mathHost.outerHTML,
        r.json.data && r.json.data.element.dataType);
    expect("行级公式：hit 记录原始命中（span.mord）",
        r.json.data && r.json.data.hit && r.json.data.hit.className === "mord mathnormal",
        JSON.stringify(r.json.data && r.json.data.hit));
    expect("行级公式：lineIsBlock = false", r.json.data && r.json.data.lineIsBlock === false);
    expect("行级公式：块仍是段落", r.json.data && r.json.data.blockType === "NodeParagraph", r.json.data && r.json.data.blockType);

    hoverChain.length = 0;
    hoverChain.push(mathBlock, bmWrap, bmSpan, bmMord);   // 指针压在块级公式内部
    r = await req("GET", "/mouse", {token: TOKEN});
    expect("块级公式：行元素收敛到 NodeMathBlock",
        r.json.data && r.json.data.element.dataType === "NodeMathBlock" && r.json.data.lineHTML === mathBlockOuter,
        r.json.data && r.json.data.element.dataType);
    expect("块级公式：lineIsBlock = true", r.json.data && r.json.data.lineIsBlock === true);
    expect("块级公式：blockId 是公式块", r.json.data && r.json.data.blockId === "20260930132334-33pwqnx",
        r.json.data && r.json.data.blockId);

    // --- 指针记忆：鼠标离开窗口后（:hover 空链）仍能取到上次位置 ---
    hoverChain.length = 0;
    const fire = (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev));
    fire("mouseover", {target: mordEl, clientX: 500, clientY: 400});
    r = await req("GET", "/mouse", {token: TOKEN});
    expect("指针离开窗口：回退到记忆位置（source=cache）",
        r.json.data && r.json.data.source === "cache" && r.json.data.element.dataType === "inline-math",
        JSON.stringify({source: r.json.data && r.json.data.source, dt: r.json.data && r.json.data.element && r.json.data.element.dataType}));
    expect("指针记忆：带上 pointerAgeMs", r.json.data && typeof r.json.data.pointerAgeMs === "number",
        r.json.data && r.json.data.pointerAgeMs);

    // 指针移到编辑器空白处：不能覆盖掉有效记忆
    fire("mouseover", {target: wysiwyg, clientX: 10, clientY: 10});
    r = await req("GET", "/mouse", {token: TOKEN});
    expect("编辑器空白不覆盖有效记忆", r.json.data && r.json.data.source === "cache"
        && r.json.data.element.dataType === "inline-math", r.json.data && r.json.data.source);

    // 指针在完全无关的地方（侧栏）且无记忆时，404 要带诊断信息
    hoverChain.length = 0;
    r = await req("GET", "/mouse?at=" + encodeURIComponent(".not-exist"), {token: TOKEN});
    expect("选择器没命中时 404 且提示选择器", r.status === 404 && /选择器/.test(r.json.error && r.json.error.message),
        r.json.error && r.json.error.message);
    expect("404 附带 diag 诊断", !!(r.json.diag && typeof r.json.diag.hoverCount === "number"),
        JSON.stringify(r.json.diag));

    hoverChain.length = 0;
    hoverChain.push(p1, strongEl);

    // 脚本内直接调用鼠标相关函数
    hoverChain.push(p1, strongEl);
    r = await req("POST", "/run", {
        token: TOKEN,
        body: {code: "const m = getMouse(); return {block: m.blockId, doc: m.docId, tag: getMouseLineEl().tagName, same: getMouseBlockHTML() === getBlockHTML()};"},
    });
    expect("脚本内 getMouse() 可用", r.json.result && r.json.result.block === "20261004111715-01xuh9w", JSON.stringify(r.json.result || r.json.error).slice(0, 100));
    expect("脚本内 getMouseLineEl 是真 DOM", r.json.result && r.json.result.tag === "STRONG" && r.json.result.same === true);

    // --- 脚本里直接调用这几个函数 ---
    r = await req("POST", "/run", {
        token: TOKEN,
        body: {code: "return {block: getBlockHTML(), line: getLineHTML(), tag: getLineEl().tagName, same: getBlockEl() === getLineEl()};"},
    });
    expect("脚本内 getBlockHTML() 可用", r.json.result && r.json.result.block === P1_OUTER, JSON.stringify(r.json.result || r.json.error).slice(0, 100));
    expect("脚本内 getLineHTML() 可用（strong）", r.json.result && r.json.result.line === strongEl.outerHTML);
    expect("脚本内 getBlockEl/getLineEl 是真 DOM", r.json.result && r.json.result.tag === "STRONG" && r.json.result.same === false);

    // --- 直接 return DOM 元素不能把响应搞崩（元素有循环引用）---
    r = await req("POST", "/run", {token: TOKEN, body: {code: "return getBlockEl();"}});
    expect("return DOM 元素被自动转成快照", r.json.ok && r.json.result && r.json.result.html === P1_OUTER
        && r.json.result.nodeId === "20261004111715-01xuh9w", JSON.stringify(r.json.result || r.json.error).slice(0, 120));

    r = await req("POST", "/run", {token: TOKEN, body: {code: "const o = {a: 1}; o.self = o; return o;"}});
    let deep = r.json.result;
    let hops = 0;
    while (deep && typeof deep === "object" && hops < 30) {
        deep = deep.self;
        hops++;
    }
    expect("循环引用对象不会让响应崩掉", r.json.ok === true && r.json.result.a === 1 && deep === "[max depth]", `hops=${hops}`);

    // 复位：后续用例仍以 p1text 为光标
    docSelection = {rangeCount: 1, getRangeAt: () => makeRange(p1text, 2)};
    (listeners["selectionchange"] || []).forEach((fn) => fn());

    // --- 光标在表格单元格里：块必须是 NodeTable，不能是单元格内的临时段落 ---
    docSelection = {rangeCount: 1, getRangeAt: () => makeRange(cellText, 1)};
    (listeners["selectionchange"] || []).forEach((fn) => fn());

    r = await req("GET", "/cursor", {token: TOKEN});
    expect("表格内：块类型为 NodeTable", r.json.data && r.json.data.blockType === "NodeTable",
        r.json.data && r.json.data.blockType);
    expect("表格内：块 ID 是表格块，不是单元格临时段落", r.json.data && r.json.data.blockId === "20241117120219-w1ptehx",
        r.json.data && r.json.data.blockId);
    expect("表格内：blockHTML 是整张表", r.json.data && r.json.data.blockHTML === TABLE_OUTER,
        String((r.json.data && r.json.data.blockHTML) || "").slice(0, 60));
    expect("表格内：inTable = true", r.json.data && r.json.data.inTable === true);
    expect("表格内：cell 行列号正确（0 行 1 列）",
        r.json.data && r.json.data.cell && r.json.data.cell.row === 0 && r.json.data.cell.col === 1,
        JSON.stringify(r.json.data && r.json.data.cell).slice(0, 80));
    expect("表格内：cell.text 是单元格文字", r.json.data && r.json.data.cell && r.json.data.cell.text === "单元格文字");
    expect("表格内：innerBlockId 单独给出（临时 ID）", r.json.data && r.json.data.innerBlockId === "20261022174156-icgusys",
        r.json.data && r.json.data.innerBlockId);
    expect("表格内：lineHTML 仍是光标所在那层", r.json.data && r.json.data.lineHTML === cellP.outerHTML,
        String((r.json.data && r.json.data.lineHTML) || "").slice(0, 60));

    r = await req("GET", "/dom", {token: TOKEN});
    expect("表格内：/dom 的 block 是表格", r.json.data && r.json.data.block && r.json.data.block.nodeId === "20241117120219-w1ptehx");
    expect("表格内：/dom 带 cell.html", r.json.data && r.json.data.cell && r.json.data.cell.html === tblCell.outerHTML);

    r = await req("GET", "/block", {token: TOKEN});
    expect("表格内：/block 裸 HTML 是整张表", r.json._raw === TABLE_OUTER, String(r.json._raw || "").slice(0, 60));

    r = await req("POST", "/run", {token: TOKEN, body: {code: "return {t: getBlockEl().getAttribute('data-type'), cell: getCursor().cell.col};"}});
    expect("表格内：脚本 getBlockEl() 指向表格块", r.json.result && r.json.result.t === "NodeTable",
        JSON.stringify(r.json.result || r.json.error).slice(0, 80));

    // 复位：后续用例仍以 p1text 为光标
    docSelection = {rangeCount: 1, getRangeAt: () => makeRange(p1text, 2)};
    (listeners["selectionchange"] || []).forEach((fn) => fn());

    // --- /run 基本 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "return 1 + 2;"}});
    expect("简单返回值", r.status === 200 && r.json.ok === true && r.json.result === 3, JSON.stringify(r.json).slice(0, 120));

    // --- 控制台命名空间（Ctrl+Shift+I 里直接调）---
    plugin._exposeToConsole();
    expect("挂载 window.__jsBridge", !!global.window.__jsBridge
        && typeof global.window.__jsBridge.getBlockHTML === "function", typeof global.window.__jsBridge);
    expect("__jsBridge.getBlockHTML() 可用", global.window.__jsBridge.getBlockHTML() === P1_OUTER);
    const bridgeRun = await global.window.__jsBridge.run("return 7;");
    expect("__jsBridge.run() 可用", bridgeRun.ok && bridgeRun.result === 7, JSON.stringify(bridgeRun).slice(0, 80));

    // --- 注入变量 ---
    r = await req("POST", "/run", {
        token: "test-token-1234567890",
        body: {code: "return {cursor: getCursor().blockId, hasSiYuan: !!siyuan, hasApp: !!app, hasPlugin: !!plugin, hasFetch: typeof fetchSyncPost, v: vars.x};", vars: {x: 42}},
    });
    expect("注入变量齐全", r.json.ok && r.json.result && r.json.result.cursor === "20261004111715-01xuh9w"
        && r.json.result.hasSiYuan && r.json.result.hasApp && r.json.result.hasPlugin
        && r.json.result.hasFetch === "function" && r.json.result.v === 42, JSON.stringify(r.json.result));

    // --- await 支持 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "await sleep(30); return 'awake';"}});
    expect("支持 await", r.json.ok && r.json.result === "awake", JSON.stringify(r.json.result));

    // --- console 捕获 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "console.log('hello', {a:1}); console.warn('warn!'); return 1;"}});
    expect("捕获 console.log（含对象序列化）", r.json.ok && r.json.logs.some((l) => l.includes('hello {"a":1}')), JSON.stringify(r.json.logs));
    expect("注入的 console 里 warn 也进 logs", r.json.ok && r.json.logs.some((l) => l.includes("warn!")), JSON.stringify(r.json.logs));

    // --- 错误 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "throw new Error('炸了');"}});
    expect("错误被捕获并返回 500", r.status === 500 && r.json.ok === false && r.json.error.message === "炸了", JSON.stringify(r.json.error).slice(0, 100));

    // --- 语法错误 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "this is not js((("}});
    expect("语法错误被捕获", r.json.ok === false && !!r.json.error.message, r.json.error && r.json.error.name);

    // --- 超时 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "await sleep(3000); return 'too late';", timeoutMs: 300}});
    expect("超时生效", r.json.ok === false && /超时/.test(r.json.error.message), r.json.error && r.json.error.message);

    // --- 空 code ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "   "}});
    expect("空 code 返回 400", r.status === 400, `status=${r.status}`);

    // --- 超大 body ---
    // 服务端会 req.destroy()，客户端一侧可能拿到 413 也可能拿到 ECONNRESET，两种都算正确拦截
    let bigStatus;
    try {
        r = await req("POST", "/run", {token: "test-token-1234567890", body: {code: "return 1;", pad: "x".repeat(80 * 1024)}});
        bigStatus = r.status;
    } catch (e) {
        bigStatus = "conn-reset";
    }
    expect("超大 body 被拦截（413 或连接重置）", bigStatus === 413 || bigStatus === "conn-reset", `result=${bigStatus}`);

    // --- text/plain 裸代码 ---
    r = await req("POST", "/run", {token: "test-token-1234567890", body: "return 'plain';", contentType: "text/plain"});
    expect("text/plain 裸代码可用", r.json.ok && r.json.result === "plain", JSON.stringify(r.json).slice(0, 100));

    // --- Authorization Bearer ---
    const bearer = await new Promise((resolve) => {
        const rq = http.request({host: "127.0.0.1", port: PORT, path: "/health", method: "GET",
            headers: {Authorization: "Bearer test-token-1234567890"}}, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        rq.end();
    });
    expect("Authorization Bearer 可用", bearer === 200, `status=${bearer}`);

    // --- 串行：两个请求同时发，日志不串台 ---
    const [a, b] = await Promise.all([
        req("POST", "/run", {token: "test-token-1234567890", body: {code: "console.log('AAA'); await sleep(120); console.log('AAA-end'); return 'A';"}}),
        req("POST", "/run", {token: "test-token-1234567890", body: {code: "console.log('BBB'); await sleep(30); return 'B';"}}),
    ]);
    expect("并发请求各自成功", a.json.ok && b.json.ok && a.json.result === "A" && b.json.result === "B",
        `A=${JSON.stringify(a.json.logs)} B=${JSON.stringify(b.json.logs)}`);
    expect("日志不串台（A 只含 AAA）", a.json.logs.every((l) => !l.includes("BBB")), JSON.stringify(a.json.logs));
    expect("日志不串台（B 只含 BBB）", b.json.logs.every((l) => !l.includes("AAA")), JSON.stringify(b.json.logs));

    // --- 404 ---
    r = await req("GET", "/nope", {token: "test-token-1234567890"});
    expect("未知路径 404", r.status === 404, `status=${r.status}`);

    // --- CORS 预检 ---
    const preflight = await new Promise((resolve) => {
        const rq = http.request({host: "127.0.0.1", port: PORT, path: "/run", method: "OPTIONS"}, (res) => {
            res.resume();
            res.on("end", () => resolve({status: res.statusCode, acao: res.headers["access-control-allow-origin"]}));
        });
        rq.end();
    });
    expect("OPTIONS 预检返回 204 + CORS 头", preflight.status === 204 && preflight.acao === "*", JSON.stringify(preflight));

    await plugin._stopServer();
    const afterStop = await req("GET", "/health", {token: "test-token-1234567890"}).then(() => false).catch(() => true);
    expect("停止后端口关闭", afterStop === true, "connection refused");

    printOut();
    process.exit(results.every((x) => x.pass) ? 0 : 1);
})().catch((e) => {
    console.error("FATAL", e);
    printOut();
    process.exit(1);
});

function printOut() {
    let pass = 0;
    for (const r of results) {
        console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.extra ? "   -> " + r.extra : ""}`);
        if (r.pass) {
            pass++;
        }
    }
    console.log(`\n${pass}/${results.length} 通过`);
}
