# 运行 JS 脚本（siyuan-plugin-jsrunner）v1.3.0

**简体中文** | [English](./README.md)

![icon](icon.png)

> ✅ **代码状态（2026-11-08 方案 B）**
> JS Bridge 的可运行文件（`index.js` / `index.css` / `i18n/` / `test-e2e.js`）**已合入本仓库根目录**：第 6 章的 `6866` 端点、访问令牌与 `/mouse` 现在就是本仓库代码提供的能力（已在本机思源 3.8.8 实测）。
> 2023 年的 TypeScript / webpack 版（端口 49465）**保留在 `src/` 作历史存档**，不再是插件入口。
> ⚠️ **不要跑 `pnpm run dev` / `pnpm run build`**：旧 webpack 配置仍指向 `src/index.ts`，development 模式会输出根目录 `index.js` 覆盖已合入的版本。详见 [第 10 章](#10-构建与发布开发者)。

---

## 1 一句话概括

让 **Quicker、WorkBuddy、C#、Python 或任何本地程序**把一段 JavaScript 送进思源笔记的**渲染进程**执行，再把返回值、console 日志、错误堆栈以 JSON 原样带回来。

一句话区分：思源内核 API（`6806`）管的是"文档和块的数据"，本插件管的是"**光标在哪、鼠标指着谁、屏幕上这一段 HTML 长什么样**"。

## 2 主要功能

| 功能 | 说明 |
|---|---|
| 2.1 执行任意 JS | POST 一段代码到渲染进程，支持 `await` / `return`，返回值、日志、错误堆栈一并回传 |
| 2.2 取当前块 ID | 不用自己去 DOM 里 `querySelector` 拼选择器，直接 `getCursor().blockId` |
| 2.3 光标处的块与行 | 一次给出整个块的 `outerHTML` 和光标所在那层行元素（`<strong>` / `<span>` / 段落）的 `outerHTML` |
| 2.4 鼠标处的块与行 | `/mouse` 取指针压着的节点，**不移动光标**；指针离开窗口后回退到最后一次真实位置 |
| 2.5 祖先链与选区 | `getDom()` 给出块 + 行 + 祖先链 + 光标偏移、是否折叠、选中文本，全是纯数据可直接 JSON 化 |
| 2.6 表格单元格特例 | 自动识别 lite 编辑器的临时 ID，`blockId` 一律给整张 `NodeTable`，另给 `cell.row/col` |
| 2.7 直连内核 API | 脚本里 `fetchSyncPost()` 可继续调 `/api/query/sql`、`/api/block/appendBlock` 等，用当前登录态 |
| 2.8 令牌鉴权 | 请求头、Bearer、query 三种传法任选；令牌首次启动随机生成 |
| 2.9 Quicker 免写代码 | 一个「HTTP 请求」步骤即可把块 ID 送进下一步动作 |

> 2.1–2.9 均由仓库根目录的 `index.js`（6866 版）提供；`src/` 里的 2023 版只提供 2.1 且端口为 49465。见 [第 4 章](#4-两代版本49465-与-6866)。

## 3 它解决了思源内核 API 的哪些问题

思源内核（`127.0.0.1:6806`）是**无状态**的：`/api/*` 下没有任何 `cursor` / `selection` 路由（对 `kernel/apicontract/schema.json` 全部 727 个端点核对过，0 命中）。光标、选区、`Protyle` 实例、`document` 只存在于渲染进程。

| 你想做的事 | 只用内核 `6806` | 用本插件 |
|---|---|---|
| 3.1 取"当前正在编辑的块" | 没有这个端点，只能靠外部记录 ID | `getCursor().blockId` 直接拿 |
| 3.2 取光标所在的加粗片段 / 公式 | 只能拿到整块的 Markdown | `lineHTML` 给那一层元素的完整 HTML |
| 3.3 取鼠标指着谁（不点下去） | 完全做不到 | `/mouse`，走浏览器 `:hover` 链 |
| 3.4 点过侧栏、搜索框后还能定位 | 焦点一丢就没了 | 选区记忆，`source: "memory"` 仍可用 |
| 3.5 改表格里某个单元格 | 单元格内是临时 ID，内核查不到 | `blockId` 给整表，`cell.row/col` 给位置 |
| 3.6 在脚本里接着改文档 | 要自己带 token 发 HTTP | `fetchSyncPost()` 用当前登录态，免 token |

## 4 两代版本：49465 与 6866

| 对比项 | 本仓库 `master`（2023 版） | 配套 JS Bridge（2026 版） |
|---|---|---|
| 4.1 端口 | `127.0.0.1:49465` | `127.0.0.1:6866` |
| 4.2 形态 | TypeScript + webpack，`src/index.ts` / `src/JSRunner.ts` | 单文件 `index.js`，`require("siyuan")` + `module.exports = class extends Plugin`，零依赖 |
| 4.3 入口 | 仅 `POST /`，裸代码 | `POST /run` + 9 个 GET 端点 |
| 4.4 鉴权 | **无** | 令牌必填，三通道 |
| 4.5 返回值 | 结果本身 | `{ok, result, logs, error, durationMs}` |
| 4.6 光标 / DOM / 鼠标 | 无，靠调用方自己写选择器 | 内置 `/cursor` `/dom` `/mouse` |
| 4.7 最低思源版本 | `2.9.3`，仅 Windows | `3.1.0+`，Windows / Linux / macOS 桌面端 |
| 4.8 源码位置 | `src/`，仅作历史存档 | **本仓库根目录 `index.js`**，2026-11-08 已合入 |

取舍一句话：**现在直接用根目录的 `index.js`（6866 版）**；`src/` 里的 49465 版只是历史存档，除非要复现旧行为，否则不要构建它。

## 5 主要依赖与配置

### 5.1 依赖（缺一不可）

| 依赖 | 版本 | 说明 |
|---|---|---|
| 思源笔记 | **3.1.0+**（`plugin.json` 已按 6866 版设置） | **仅桌面端**，渲染进程里要有 Node（`http` 模块）；旧 49465 源码要求 2.9.3+ |
| Node / pnpm | 构建 2023 版代码时才需要 | `pnpm install` → `pnpm run build` |
| 思源内核 API | `127.0.0.1:6806` | 脚本里 `fetchSyncPost()` 会用到；**和 6866 / 49465 都不是一回事** |

> 所有地址一律写 `127.0.0.1`，**不要写 `localhost`**：本机代理会把 `localhost` 拦成 502，容易被误判成"思源没启动"。三台机器（单位机 / 家机 / 笔记本）用户目录不同，脚本里请用 `~` 或环境变量推导路径，不要写死用户名。

### 5.2 安装（本仓库代码）

1. 把整个仓库目录复制到 `<工作空间>/data/plugins/`（根目录 `index.js` 即插件入口，**不需要构建**）
2. 重启思源，或在 `设置 → 集市 → 已下载` 里刷新
3. `设置 → 插件` 中启用「运行JS脚本」
4. `设置 → 插件 → 运行JS脚本 → 设置 → 访问令牌` 取令牌（或右键顶栏 ✨ 图标 →「复制访问令牌」）

根目录 `index.js` 开箱即用。旧 49465 源码若要构建，跑 `pnpm run dev` / `build`，产物进 `dist/`，不会覆盖新版，见第 10 章。

### 5.3 设置项

| 项 | 默认 | 说明 |
|---|---|---|
| 端口 | 49465（本仓库代码）/ 6866（JS Bridge） | 被占用时弹 `EADDRINUSE`，改端口或关掉占用者 |
| 访问令牌 | 6866 版首次启动随机生成 | 49465 版没有此项 |
| 请求体上限 `maxBodyKB` | 2 MB（6866 版） | 超限直接拒绝 |
| 执行超时 `timeoutMs` | 15 s（6866 版） | 只对异步代码有效，同步死循环无法中断 |

## 6 接口速查（JS Bridge，6866）

> 本章端点由仓库根目录 `index.js` 提供，2026-11-08 已合入。全部监听 `127.0.0.1:6866`，**每个请求都要带令牌**；清单与代码里的 `url.pathname ===` 路由逐一核对过。

### 6.1 鉴权

三种任选其一：

```
X-Bridge-Token: <token>
Authorization: Bearer <token>
?token=<token>
```

### 6.2 端点一览

| 端点 | 方法 | 返回 | 说明 |
|---|---|---|---|
| `/health` | GET | JSON | `ok` / `port` / `uptimeSec` / `runs` / `lastRun` |
| `/cursor` | GET | JSON | 光标处：块 ID、文档 ID、块 HTML、行 HTML、选区 |
| `/dom` | GET | JSON | 块 + 行 + 祖先链 + 光标，纯数据 |
| `/block` | GET | `text/html` | 只要整个块的 HTML 本体 |
| `/line` | GET | `text/html` | 只要当前行元素的 HTML 本体 |
| `/mouse` | GET | JSON | 鼠标处，字段名与 `/cursor` 完全一致 |
| `/mouse/block` | GET | `text/html` | 鼠标处块的 HTML 本体 |
| `/mouse/line` | GET | `text/html` | 鼠标处行元素的 HTML 本体 |
| `/run` | POST | JSON | 执行 JS，回传 `result` / `logs` / `error` |

`?html=0` 可去掉大块的 HTML 载荷；`/mouse?at=<CSS选择器>` 可在指针不在正文时按选择器定位。`/mouse` 的 `source` 有三种：`hover`（真指针）、`selector`（`?at=`）、`cache`（指针已离开窗口，配 `pointerAgeMs`）。

### 6.3 POST /run

```json
{
  "code": "return getCursor();",
  "timeoutMs": 15000,
  "vars": {"anything": "you want"}
}
```

也接受 `{"script": "..."}` 或 `text/plain` 裸代码。响应：

```json
{"ok":true,"result":{...},"logs":["..."],"durationMs":12}
{"ok":false,"error":{"name":"Error","message":"...","stack":"..."},"logs":[],"durationMs":3}
```

函数体内可直接用的变量：

| 变量 | 含义 |
|---|---|
| `siyuan` / `app` / `plugin` | `require("siyuan")` 全部导出 / 思源 App 实例 / 本插件实例 |
| `getCursor()` / `getDom()` / `getMouse()` | 对应 GET 端点的数据 |
| `getBlockEl()` / `getLineEl()` | 光标处块 / 行的真 DOM 元素 |
| `getBlockHTML()` / `getLineHTML()` | 对应 `outerHTML` 字符串 |
| `getMouseBlockEl()` / `getMouseLineEl()` | 鼠标处块 / 行的真 DOM 元素 |
| `getMouseBlockHTML()` / `getMouseLineHTML()` | 对应 `outerHTML` 字符串 |
| `fetchSyncPost(url, data)` | 直连内核 API |
| `sleep(ms)` / `waitFor(fn, {timeout})` / `log(...)` / `vars` | 异步等待 / 写日志 / 透传变量 |

直接 `return` DOM 元素也安全：插件会把节点转成 `{tag, className, nodeId, childCount, textLength, html}` 快照，避开 `parentNode` 循环引用。

### 6.4 表格单元格特例

思源把单元格内容放在 lite 编辑器里：`td > .table__cell-editor > .protyle-wysiwyg > .p[data-node-id]`。那层 `.p` 的 ID 是**临时 ID**，`getBlockInfo` / `getBlockKramdown` / `appendBlock` 全部查不到。

所以在表格内：`blockId` / `blockType` / `blockHTML` 一律给**整张 `NodeTable`**；`cell` 给 `{tag,row,col,text,html}`；`innerBlockId` 只是线索，别拿去调内核。要改单元格，用 `blockId` + `updateBlock` 重写整表，或按 `cell.row/col` 拼好 markdown 再整表更新。

## 7 用法与示例

### 7.1 C#（本仓库 49465 版）

```csharp
private static async Task<JToken> RunAsync(string jsCode)
{
    string url = "http://127.0.0.1:49465";
    var body = new StringContent(jsCode, Encoding.UTF8, "application/json");
    using HttpClient client = new HttpClient();
    HttpResponseMessage response = await client.PostAsync(url, body).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
    string responseBody = await response.Content.ReadAsStringAsync();
    return JToken.Parse(responseBody);
}

// 当前块 ID
string jsCode = """
document.querySelector("div:not(.fn__none).fn__flex-1.protyle .protyle-breadcrumb__item:not(.protyle-breadcrumb__item--active)").attributes["data-node-id"].value
""";
string block_id = RunAsync(jsCode).Result;

// 当前文档 ID
string jsDoc = """
document.querySelector("div:not(.fn__none).fn__flex-1.protyle .protyle-breadcrumb__item--active").attributes['data-node-id'].value
""";
string doc_id = RunAsync(jsDoc).Result;
```

49465 版只能这样自己写选择器、自己解析返回值；**没有 `/cursor`、没有令牌、没有 `ok/result/logs` 包装**。

### 7.2 Quicker

- 旧版现成动作（取当前块 ID）：<https://getquicker.net/Sharedaction?code=83e09d58-db88-4f8e-7b24-08dba207b0f4>
- 6866 版：动作里加「HTTP 请求」步骤

```
网址：http://127.0.0.1:6866/run
方法：POST
头：  Content-Type: application/json
      X-Bridge-Token: <你的令牌>
体：  {"code":"return getCursor().blockId;"}
```

解析 `$.result` 即块 ID。

### 7.3 curl / WorkBuddy

```bash
TOKEN=你的令牌
curl -s --noproxy '*' "http://127.0.0.1:6866/health?token=$TOKEN"
curl -s --noproxy '*' "http://127.0.0.1:6866/cursor?token=$TOKEN"

curl -s --noproxy '*' -X POST "http://127.0.0.1:6866/run" \
  -H "Content-Type: application/json" \
  -H "X-Bridge-Token: $TOKEN" \
  -d '{"code":"const c = getCursor(); return {id: c.blockId, title: c.docTitle};"}'

# 鼠标处（不移动光标）
curl -s --noproxy '*' "http://127.0.0.1:6866/mouse?html=0&token=$TOKEN"
```

> `--noproxy '*'` 是本机环境专用：本机 `http_proxy` 指向失效端口，不加会被代理拦掉。

### 7.4 Python

```python
import requests
H = {"X-Bridge-Token": "你的令牌", "Content-Type": "application/json"}

r = requests.post("http://127.0.0.1:6866/run", headers=H, json={
    "code": """
        const c = getCursor();
        if (!c || !c.blockId) return {status: "no-cursor"};
        const r = await fetchSyncPost("/api/block/getBlockInfo", {id: c.blockId});
        return {blockId: c.blockId, doc: r.data.rootTitle};
    """
}, timeout=20).json()
print(r["result"])
```

### 7.5 典型脚本：把当前块追加到今日日记

```js
const c = getCursor();
if (!c) return "没有光标";

const ids = await fetchSyncPost("/api/query/sql", {
    stmt: `SELECT id FROM blocks WHERE type='d' AND ial LIKE '%custom-daily-note%' ORDER BY created DESC LIMIT 1`
});
const dailyId = ids.data?.[0]?.id;
if (!dailyId) return "没找到日记";

await fetchSyncPost("/api/block/appendBlock", {
    parentID: dailyId,
    dataType: "markdown",
    data: `- [ ] 处理：${c.blockText} （来自 [[${c.docTitle}]]）\n`
});
return "已追加";
```

> 内核 SQL 默认只返回 **64 行**，需要更多要显式写 `LIMIT 1000`。查字段一律以 `kernel/apicontract/schema.json` 为准（例如 `getRecentDocs` 返回的是 `rootID` / `title`，不是 `id` / `content`）。

## 8 现有不足与已知坑

| 情况 | 行为 / 正确做法 |
|---|---|
| 8.1 **构建链已修好** | `dev` / `build` 一律输出到 `dist/`，不再覆盖根目录 `index.js`；`CopyPlugin` 改读根目录 `i18n/`。发布新版用 `npm run pack` |
| 8.2 三套端口 | `6806` 内核 API / `49465` 旧版 / `6866` JS Bridge，别混 |
| 8.3 `localhost` | 本机被代理拦成 502，一律用 `127.0.0.1` |
| 8.4 焦点不在正文 | `/cursor` 返回 `404` + `no cursor`，先在正文里点一下；`/mouse` 可用 `?at=` 选择器绕过 |
| 8.5 鼠标在公式上 | 行元素 DOM 显示异常【待确认：公式块的行容器结构与普通段落不同】，已知遗留 |
| 8.6 `no mouse` 误报 | 早期版本指针命中判定过严，404 提示已拆成「选择器没命中」与「指针不在块上」两种 |
| 8.7 手机 / 浏览器端 | 没有 Node 环境，`http` 服务起不来，插件能加载但不监听 |
| 8.8 端口被占用 | `EADDRINUSE` 弹提示；新开第二个思源窗口也会抢同一端口 |
| 8.9 同步死循环 | `timeoutMs` 拦不住，需重启渲染进程 |
| 8.10 令牌泄露 | 等于把渲染进程执行权交出去，不要写进公开仓库、不要截图外发 |
| 8.11 真指针验证 | 思源窗口被遮挡时无法验证，别为了验证去抢窗口焦点 |

## 9 技术实现（附录）

| 环节 | 做法 |
|---|---|
| 为什么必须是插件 | 内核 `6806` 无状态，光标 / 选区 / `Protyle` / `document` 只在渲染进程；只有跑在渲染进程里的代码拿得到 |
| 运行形态 | 桌面端 Electron 渲染进程开启 `nodeIntegration`，可直接 `require("http")` 起一个只监听 `127.0.0.1` 的小服务 |
| 取鼠标处 | `document.querySelectorAll(":hover")` 返回从 `<html>` 到被指元素的祖先链，末端即命中节点；不装 `mousemove`、不改 DOM |
| 行元素归一化 | 公式内部回到公式宿主、`<svg><use>` 跳到宿主、有 `data-type` 或行内标签直接采用、`div[contenteditable]` 作为行边界 |
| 返回值序列化 | DOM 节点先转 `{tag, className, nodeId, childCount, textLength, html}` 快照，避开循环引用 |
| 安全边界 | 仅回环地址 + 令牌 + 请求体上限 + 执行超时 + **串行执行**（并发脚本不会互踩 `console` 与编辑器状态） |
| 2023 版代码结构 | `src/index.ts`（插件主类）→ `src/JSRunner.ts`（49465 HTTP 服务）→ `src/index.scss`；webpack 打包 |
| 2026 版代码结构 | 根目录 `index.js` + `index.css` + `i18n/{en_US,zh_CN}.json` + `test-e2e.js`，零依赖；`src/` 保留旧 TS 存档 |

## 10 构建与发布（开发者）

```bash
node --check index.js        # 根目录 6866 版语法自查
node --check test-e2e.js     # 端到端测试脚本
npm run pack                 # 产出 package.zip（文件在 zip 根层）
```

- `pnpm run dev` / `pnpm run build` 只编译 `src/` 里的 2023 版（49465），产物进 `dist/`，**不会**覆盖根目录的 6866 版；发布新版本请用 `npm run pack`
- `scripts/pack.py` 把 `plugin.json`、`index.js`、`index.css`、`i18n/`、`icon.png`、`README*.md`、`LICENSE` 放进 **zip 根层**（已实测），套一层同名目录会导致集市安装后不加载
- `plugin.json` 的 `version`、`package.json` 的 `version`、README 标题里的版本号、GitHub Release 的 tag **四者保持一致**
- 集市只认 **GitHub Latest Release 里的 `package.zip`**；仅 push 源码不算发布
- 首次上架需向 `siyuan-note/bazaar` 提 PR 在 `plugins.txt` 追加一行；之后每次发版按 `plugin.json` 的版本重新生成索引
- 换电脑要重新填令牌（令牌存在本机配置里，不随思源同步）

## 11 许可

MIT License © ttChen

---

## 版本史

| 版本 / 日期 | 内容 |
|---|---|
| 1.3.0 · 2026-11-08 | 修复构建链与忽略规则，新增 `npm run pack`，版本号四处同步并发布 `package.zip` |
| 2026-11-08（方案 B） | 合入 JS Bridge 的 `index.js` / `index.css` / `i18n/` / `test-e2e.js`；`plugin.json` 更新为 3.1.0+ 与三平台；旧 TS 源码保留在 `src/` |
| 2026-11-08（方案 A） | 按 `siyuan-plugin-zotero-cite` 的规格重写中英文 README；版本号两处对齐 |
| 1.2.15 · 2023-08-29 | 本仓库最后一次提交：更新 `README_zh_CN.md` / `index.ts` / `plugin.json` |
| 0.1.12 · 2023-08-01 | 升级 siyuan 到 0.7.9（来自 `CHANGELOG.md`） |
| 0.1.11 | 加入 `input-search` 事件总线示例（来自 `CHANGELOG.md`，原文未标日期） |
| 0.1.6 | 加入 `fetchPost` 示例（来自 `CHANGELOG.md`，原文未标日期） |
