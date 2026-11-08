# Run JS in SiYuan (siyuan-plugin-jsrunner) v1.3.0

**English** | [简体中文](./README_zh_CN.md)

![icon](icon.png)

> ✅ **Code status (2026-11-08, plan B)**
> The runnable JS Bridge files (`index.js` / `index.css` / `i18n/` / `test-e2e.js`) **are now merged into this repository's root**: the `6866` endpoints, access token and `/mouse` in Chapter 6 are provided by the code in this repository (verified locally on SiYuan 3.8.8).
> The 2023 TypeScript / webpack build (port 49465) **is kept in `src/` as a historical archive** and is no longer the plugin entry point.
> ⚠️ **Do not run `pnpm run dev` / `pnpm run build`**: the legacy webpack config still points at `src/index.ts`, and development mode writes a root-level `index.js` that would overwrite the merged file. See [Chapter 10](#10-build-and-release-developers).

---

## 1 In one sentence

Let **Quicker, WorkBuddy, C#, Python or any local program** send a piece of JavaScript into SiYuan's **renderer process**, and get the return value, console logs and error stack back as JSON.

Short version: the SiYuan kernel API (`6806`) owns "documents and blocks as data"; this plugin owns "**where the caret is, what the pointer is over, and what that fragment of HTML actually looks like**".

## 2 What it does

| Feature | Detail |
|---|---|
| 2.1 Run arbitrary JS | POST code into the renderer; `await` / `return` supported; value, logs and error stack all come back |
| 2.2 Get the current block ID | No hand-written `querySelector` chain — just `getCursor().blockId` |
| 2.3 Block and line at the caret | `outerHTML` of the whole block plus `outerHTML` of the line element holding the caret (`<strong>` / `<span>` / paragraph) |
| 2.4 Block and line under the mouse | `/mouse` reads the node under the pointer **without moving the caret**; falls back to the last real hover position after the pointer leaves the window |
| 2.5 Ancestor chain and selection | `getDom()` returns block + line + ancestors + caret offset, collapsed flag and selected text, all plain JSON-safe data |
| 2.6 Table cell special case | Recognises the lite editor's temporary ID; `blockId` is always the whole `NodeTable`, plus `cell.row/col` |
| 2.7 Reach the kernel API | `fetchSyncPost()` inside a script can call `/api/query/sql`, `/api/block/appendBlock`, etc. using the current session |
| 2.8 Token authentication | Header, Bearer or query — any one works; the token is randomly generated on first launch |
| 2.9 Quicker without code | One "HTTP request" step hands the block ID to the next action |

> 2.1–2.9 all come from the root `index.js` (6866). The 2023 code in `src/` only provides 2.1, on port 49465. See [Chapter 4](#4-two-generations-49465-and-6866).

## 3 Problems it solves that the kernel API cannot

The SiYuan kernel (`127.0.0.1:6806`) is **stateless**: there is no `cursor` / `selection` route under `/api/*` (checked against all 727 endpoints in `kernel/apicontract/schema.json`, zero hits). The caret, selection, `Protyle` instances and `document` exist only in the renderer.

| What you want | Kernel `6806` only | With this plugin |
|---|---|---|
| 3.1 The block being edited right now | No such endpoint; you have to track IDs yourself | `getCursor().blockId` |
| 3.2 The bold run / formula at the caret | Only whole-block Markdown | `lineHTML` gives the full HTML of that exact layer |
| 3.3 What the mouse points at, without clicking | Impossible | `/mouse`, via the browser's `:hover` chain |
| 3.4 Still locate the caret after clicking a sidebar or the search box | Lost as soon as focus moves | Selection memory, `source: "memory"` still works |
| 3.5 Edit one table cell | The cell uses a temporary ID the kernel cannot resolve | `blockId` gives the whole table, `cell.row/col` gives the position |
| 3.6 Keep editing the document inside the script | You must send HTTP with your own token | `fetchSyncPost()` reuses the current session, no token needed |

## 4 Two generations: 49465 and 6866

| Item | This repository `master` (2023) | Companion JS Bridge (2026) |
|---|---|---|
| 4.1 Port | `127.0.0.1:49465` | `127.0.0.1:6866` |
| 4.2 Shape | TypeScript + webpack, `src/index.ts` / `src/JSRunner.ts` | Single `index.js`, `require("siyuan")` + `module.exports = class extends Plugin`, zero dependencies |
| 4.3 Entry point | Only `POST /` with raw code | `POST /run` plus nine GET endpoints |
| 4.4 Authentication | **None** | Token required, three accepted channels |
| 4.5 Response | The raw result | `{ok, result, logs, error, durationMs}` |
| 4.6 Caret / DOM / mouse | None — callers write their own selectors | Built-in `/cursor` `/dom` `/mouse` |
| 4.7 Minimum SiYuan | `2.9.3`, Windows only | `3.1.0+`, Windows / Linux / macOS desktop |
| 4.8 Source location | `src/`, historical archive only | **Root `index.js` of this repository**, merged 2026-11-08 |

In one line: **use the root `index.js` (6866) now**; the 49465 build in `src/` is a historical archive — do not build it unless you need to reproduce the old behaviour.

## 5 Requirements and setup

### 5.1 Requirements

| Dependency | Version | Note |
|---|---|---|
| SiYuan | **3.1.0+** (`plugin.json` now follows the 6866 build) | **Desktop only** — the renderer must have Node (`http` module); the legacy 49465 source required 2.9.3+ |
| Node / pnpm | Only when building the 2023 code | `pnpm install` → `pnpm run build` |
| SiYuan kernel API | `127.0.0.1:6806` | Used by `fetchSyncPost()` inside scripts; **not the same as 6866 or 49465** |

> Always write `127.0.0.1`, **never `localhost`**: a local proxy turns `localhost` into a 502, which is easily misread as "SiYuan is not running". The three machines in use (office / home / laptop) have different user directories — derive paths from `~` or environment variables in scripts instead of hardcoding a username.

### 5.2 Install (code in this repository)

1. Copy the whole repository directory into `<workspace>/data/plugins/` (the root `index.js` is the plugin entry point, **no build needed**)
2. Restart SiYuan, or refresh under `Settings → Marketplace → Downloaded`
3. Enable "运行JS脚本" under `Settings → Plugins`
4. Copy the access token from `Settings → Plugins → 运行JS脚本 → Settings → Access token` (or right-click the ✨ top-bar icon → "Copy access token")

The root `index.js` works as-is. To build the legacy 49465 source, run `pnpm run dev` / `build`; output goes to `dist/` and never overwrites the new build, see Chapter 10.

### 5.3 Settings

| Setting | Default | Note |
|---|---|---|
| Port | 49465 (this repository) / 6866 (JS Bridge) | `EADDRINUSE` toast when occupied; change the port or free it |
| Access token | Randomly generated on first launch (6866 only) | Not present in the 49465 build |
| Body limit `maxBodyKB` | 2 MB (6866) | Oversized requests are rejected |
| Execution timeout `timeoutMs` | 15 s (6866) | Only affects async code; a synchronous infinite loop cannot be interrupted |

## 6 API quick reference (JS Bridge, 6866)

> These endpoints are served by the root `index.js` in this repository, merged on 2026-11-08. All listen on `127.0.0.1:6866` and **every request requires the token**; the list was checked against the `url.pathname ===` routes in the code.

### 6.1 Auth

Any one of these:

```
X-Bridge-Token: <token>
Authorization: Bearer <token>
?token=<token>
```

### 6.2 Endpoints

| Endpoint | Method | Returns | Note |
|---|---|---|---|
| `/health` | GET | JSON | `ok` / `port` / `uptimeSec` / `runs` / `lastRun` |
| `/cursor` | GET | JSON | At the caret: block ID, doc ID, block HTML, line HTML, selection |
| `/dom` | GET | JSON | Block + line + ancestors + caret, plain data |
| `/block` | GET | `text/html` | Raw HTML of the whole block only |
| `/line` | GET | `text/html` | Raw HTML of the line element only |
| `/mouse` | GET | JSON | Under the pointer, field names identical to `/cursor` |
| `/mouse/block` | GET | `text/html` | Raw HTML of the block under the pointer |
| `/mouse/line` | GET | `text/html` | Raw HTML of the line element under the pointer |
| `/run` | POST | JSON | Run JS; returns `result` / `logs` / `error` |

`?html=0` drops the HTML payload for very large blocks; `/mouse?at=<CSS selector>` locates an element when the pointer is outside the note. `source` on `/mouse` is one of `hover` (real pointer), `selector` (`?at=`), or `cache` (pointer left the window, with `pointerAgeMs` telling you how old it is).

### 6.3 POST /run

```json
{
  "code": "return getCursor();",
  "timeoutMs": 15000,
  "vars": {"anything": "you want"}
}
```

`{"script": "..."}` and a raw `text/plain` body also work. Response:

```json
{"ok":true,"result":{...},"logs":["..."],"durationMs":12}
{"ok":false,"error":{"name":"Error","message":"...","stack":"..."},"logs":[],"durationMs":3}
```

Variables available directly inside the script body:

| Variable | Meaning |
|---|---|
| `siyuan` / `app` / `plugin` | All exports of `require("siyuan")` / the SiYuan `App` instance / this plugin instance |
| `getCursor()` / `getDom()` / `getMouse()` | Data from the matching GET endpoints |
| `getBlockEl()` / `getLineEl()` | Live DOM elements of the caret's block / line |
| `getBlockHTML()` / `getLineHTML()` | The matching `outerHTML` strings |
| `getMouseBlockEl()` / `getMouseLineEl()` | Live DOM elements of the block / line under the pointer |
| `getMouseBlockHTML()` / `getMouseLineHTML()` | The matching `outerHTML` strings |
| `fetchSyncPost(url, data)` | Call the kernel API directly |
| `sleep(ms)` / `waitFor(fn, {timeout})` / `log(...)` / `vars` | Async helpers / append to `logs` / passed-through variables |

Returning a DOM element directly is safe: nodes are converted to `{tag, className, nodeId, childCount, textLength, html}` snapshots, so the circular `parentNode` reference never reaches `JSON.stringify`.

### 6.4 Table cells

SiYuan renders cell content in a lite editor: `td > .table__cell-editor > .protyle-wysiwyg > .p[data-node-id]`. That `.p` ID is **temporary** — `getBlockInfo`, `getBlockKramdown` and `appendBlock` all fail on it.

So inside a table: `blockId` / `blockType` / `blockHTML` always refer to the **whole `NodeTable`**; `cell` carries `{tag,row,col,text,html}`; `innerBlockId` is a hint only, never feed it to the kernel. To edit a cell, use `blockId` with `updateBlock` to rewrite the whole table, or rebuild the Markdown from `cell.row/col` and update the table block.

## 7 Usage and examples

### 7.1 C# (legacy 49465 build)

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

// Current block ID
string jsCode = """
document.querySelector("div:not(.fn__none).fn__flex-1.protyle .protyle-breadcrumb__item:not(.protyle-breadcrumb__item--active)").attributes["data-node-id"].value
""";
string block_id = RunAsync(jsCode).Result;

// Current document ID
string jsDoc = """
document.querySelector("div:not(.fn__none).fn__flex-1.protyle .protyle-breadcrumb__item--active").attributes['data-node-id'].value
""";
string doc_id = RunAsync(jsDoc).Result;
```

The 49465 build forces you to write selectors and parse the raw result yourself; there is **no `/cursor`, no token, and no `ok/result/logs` wrapper**.

### 7.2 Quicker

- Ready-made legacy action (get the current block ID): <https://getquicker.net/Sharedaction?code=83e09d58-db88-4f8e-7b24-08dba207b0f4>
- For 6866, add an "HTTP request" step:

```
URL:    http://127.0.0.1:6866/run
Method: POST
Header: Content-Type: application/json
        X-Bridge-Token: <your token>
Body:   {"code":"return getCursor().blockId;"}
```

Parse `$.result` — that is the block ID.

### 7.3 curl / WorkBuddy

```bash
TOKEN=your-token
curl -s --noproxy '*' "http://127.0.0.1:6866/health?token=$TOKEN"
curl -s --noproxy '*' "http://127.0.0.1:6866/cursor?token=$TOKEN"

curl -s --noproxy '*' -X POST "http://127.0.0.1:6866/run" \
  -H "Content-Type: application/json" \
  -H "X-Bridge-Token: $TOKEN" \
  -d '{"code":"const c = getCursor(); return {id: c.blockId, title: c.docTitle};"}'

# Under the pointer, without moving the caret
curl -s --noproxy '*' "http://127.0.0.1:6866/mouse?html=0&token=$TOKEN"
```

> `--noproxy '*'` is specific to this machine: `http_proxy` points at a dead port, so requests without it get swallowed by the proxy.

### 7.4 Python

```python
import requests
H = {"X-Bridge-Token": "your-token", "Content-Type": "application/json"}

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

### 7.5 A typical script: append the current block to today's daily note

```js
const c = getCursor();
if (!c) return "no cursor";

const ids = await fetchSyncPost("/api/query/sql", {
    stmt: `SELECT id FROM blocks WHERE type='d' AND ial LIKE '%custom-daily-note%' ORDER BY created DESC LIMIT 1`
});
const dailyId = ids.data?.[0]?.id;
if (!dailyId) return "daily note not found";

await fetchSyncPost("/api/block/appendBlock", {
    parentID: dailyId,
    dataType: "markdown",
    data: `- [ ] ${c.blockText} (from [[${c.docTitle}]])\n`
});
return "appended";
```

> Kernel SQL returns only **64 rows** by default — add `LIMIT 1000` when you need more. Always check field names against `kernel/apicontract/schema.json` (for example `getRecentDocs` returns `rootID` / `title`, not `id` / `content`).

## 8 Limitations and known pitfalls

| Situation | Behaviour / what to do |
|---|---|
| 8.1 **Build chain fixed** | `dev` / `build` now write to `dist/` only and never overwrite the root `index.js`; `CopyPlugin` reads the root `i18n/`. Release the 6866 build with `npm run pack` |
| 8.2 Three ports | `6806` kernel API / `49465` legacy / `6866` JS Bridge — do not mix them up |
| 8.3 `localhost` | Local proxy turns it into a 502; always use `127.0.0.1` |
| 8.4 Focus outside the note | `/cursor` returns `404` + `no cursor`; click inside the note first. `/mouse?at=` bypasses the pointer |
| 8.5 Pointer over a formula | Line-element DOM renders incorrectly [to be confirmed: math blocks use a different line container] — known open issue |
| 8.6 `no mouse` false alarm | Early builds judged the pointer hit too strictly; the 404 message is now split into "selector did not match" and "pointer is not over a block" |
| 8.7 Mobile / browser client | No Node environment, so the HTTP server never starts; the plugin loads but does not listen |
| 8.8 Port in use | `EADDRINUSE` toast; opening a second SiYuan window also competes for the same port |
| 8.9 Synchronous infinite loop | `timeoutMs` cannot stop it; restart the renderer |
| 8.10 Leaked token | Equivalent to handing out code execution in the renderer — keep it out of public repositories and screenshots |
| 8.11 Real-pointer verification | Cannot be verified while the SiYuan window is covered; do not steal window focus just to test it |

## 9 How it works (appendix)

| Part | Approach |
|---|---|
| Why a plugin is required | Kernel `6806` is stateless; caret / selection / `Protyle` / `document` live only in the renderer, so only code running there can reach them |
| Runtime shape | Desktop Electron renderer with `nodeIntegration` can `require("http")` and start a small server bound to `127.0.0.1` only |
| Mouse lookup | `document.querySelectorAll(":hover")` returns the ancestor chain from `<html>` down to the hovered element; its last item is the hit. No `mousemove` listener, no DOM changes |
| Line normalisation | Inside math → back to the formula host; `<svg><use>` → host element; nodes with `data-type` or inline tags used as-is; `div[contenteditable]` is the line boundary |
| Return serialisation | DOM nodes become `{tag, className, nodeId, childCount, textLength, html}` snapshots to avoid circular references |
| Security boundary | Loopback only + token + body limit + execution timeout + **serial execution**, so concurrent scripts cannot clobber `console` or editor state |
| 2023 code layout | `src/index.ts` (plugin class) → `src/JSRunner.ts` (49465 HTTP server) → `src/index.scss`; bundled by webpack |
| 2026 code layout | Root `index.js` + `index.css` + `i18n/{en_US,zh_CN}.json` + `test-e2e.js`, zero dependencies; `src/` keeps the legacy TS archive |

## 10 Build and release (developers)

```bash
node --check index.js        # syntax check for the root 6866 build
node --check test-e2e.js     # end-to-end test script
npm run pack                 # produce package.zip with files at the zip root
```

- `pnpm run dev` / `pnpm run build` compile only the 2023 code in `src/` (49465) into `dist/`; they **never** overwrite the root `index.js`. Release the 6866 build with `npm run pack`
- `scripts/pack.py` puts `plugin.json`, `index.js`, `index.css`, `i18n/`, `icon.png`, `README*.md`, `LICENSE` **at the zip root** (verified); wrapping them in a same-named folder makes the marketplace install load nothing
- Keep `plugin.json` `version`, `package.json` `version`, the version in the README title and the GitHub Release tag **all in sync**
- The marketplace only reads **`package.zip` from the GitHub Latest Release**; pushing source alone is not a release
- First-time listing needs a PR to `siyuan-note/bazaar` adding a line to `plugins.txt`; later releases regenerate the index from `plugin.json`
- Re-enter the token on a new computer (it lives in local config and does not follow SiYuan sync)

## 11 License

MIT License © ttChen

---

## Version history

| Version / date | Change |
|---|---|
| 1.3.0 · 2026-11-08 | Fixed the build chain and ignore rules, added `npm run pack`, synced the version in four places and published `package.zip` |
| 2026-11-08 (plan B) | Merged JS Bridge `index.js` / `index.css` / `i18n/` / `test-e2e.js`; `plugin.json` now requires 3.1.0+ on three platforms; legacy TS source stays in `src/` |
| 2026-11-08 (plan A) | Rewrote both READMEs following the `siyuan-plugin-zotero-cite` format; aligned the two version numbers |
| 1.2.15 · 2023-08-29 | Last commit in this repository: updated `README_zh_CN.md` / `index.ts` / `plugin.json` |
| 0.1.12 · 2023-08-01 | Upgraded siyuan to 0.7.9 (from `CHANGELOG.md`) |
| 0.1.11 | Added the `input-search` event bus example (from `CHANGELOG.md`, no date in source) |
| 0.1.6 | Added a `fetchPost` example (from `CHANGELOG.md`, no date in source) |
