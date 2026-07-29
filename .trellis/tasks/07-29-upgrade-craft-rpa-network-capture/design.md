# 技术设计

## 1. 设计目标

本次升级同时解决两个相互依赖的问题：

1. 以 Playwright 上下文为准完整记录 Fetch/XHR 生命周期和内容。
2. 让 AI 通过本地接口真实观察并操作同一个录制浏览器，而不是只依据事后 trace 推断页面。

保持现有 `run.sh`、会话目录、JSONL 一行一事件和 Dashboard 使用方式兼容；不引入外部服务、数据库、鉴权系统或新的运行时依赖。

## 2. 模块边界

### `recorder/launch.js`

保留为进程编排入口，只负责：

- 启动 logger。
- 启动 persistent BrowserContext。
- 安装页面事件 binding 和 `inject.js`。
- 安装网络采集器。
- 创建 browser controller。
- 处理 page/context 生命周期与优雅退出。

网络解析、目标定位和页面观察不继续堆叠在 `launch.js` 内。

### `recorder/network-capture.js`

新增可独立测试的网络采集模块：

- 监听 BrowserContext 的 `request`、`requestfinished` 和 `requestfailed`。
- WeakMap 保存每个 Request 的开始状态，终态只允许 finalize 一次。
- 生成请求 ID，并记录 redirect 来源关系。
- 读取完整 headers、请求 body、response body、失败原因和 frame/Service Worker 上下文。
- 过滤 recorder 自身流量。
- 通过注入的 `appendEvents` 回调直接写 JSONL。

### `recorder/browser-controller.js`

新增统一浏览器感知与操作模块：

- 保留既有 tab/navigation 方法。
- 新增 observe、click、fill、type、press、select、check 和 uncheck。
- 统一 page、frame、target、timeout、歧义处理和结构化错误。
- Dashboard 和 AI HTTP API 调用同一实例，不复制定位或操作逻辑。

### `recorder/logger.js`

- 继续负责 JSONL 追加、Dashboard、events 和 control HTTP 路由。
- 返回的 server 保持 `.close()` 兼容，并公开有 JSDoc 的 `appendEvents(events)` 能力供 Playwright 侧直接落盘。
- `/log` 与 `/control/*` 使用独立的 Origin/CORS 策略。
- 控制错误统一返回 `{ error: { code, message, details } }`，保留合适 HTTP 状态。

### `recorder/inject.js`

- 继续采集 interaction、navigation 和 error。
- 删除页面级 Fetch/XHR monkey patch。
- 优先调用 Playwright 暴露的 `window.__craftRpaAppendEvents(batch)` binding。
- binding 不可用时才回退到现有 `/log` beacon/fetch 传输；回退路径遵守大小限制且使用启动时保存的原生 fetch。

### `scripts/control-client.js` 与 `scripts/run.sh`

- 新增零依赖 Node HTTP 客户端，屏蔽 curl、PowerShell 和 shell JSON 兼容差异。
- `run.sh control <action> [JSON]` 调用该客户端并原样输出结构化 JSON。
- AI 通过 `run.sh` 使用 pages、observe 和 action，不直接拼装底层 HTTP 请求。

## 3. 交互事件传输

BrowserContext 创建后按以下顺序初始化：

1. logger 已启动并提供 `appendEvents`。
2. `context.exposeBinding('__craftRpaAppendEvents', callback)` 注册到所有页面与 frame。
3. 读取 `inject.js`，在前面拼接当前 logger URL 与回退大小配置，再通过一次 `context.addInitScript({ content })` 安装交互监听，保证配置先于脚本生效。
4. 打开起始 URL。

binding 回调只接受数组或对象，经过基础结构校验后调用 logger。事件仍由 `inject.js` 补充 sessionId、clientTime、url 和 frame 信息。

HTTP `/log` 只作为兼容回退。因此正常运行不依赖目标页面访问 localhost，不需要通过关闭 Chrome 安全特性解决 CSP/PNA；`bypassCSP` 和大范围 `--disable-features` 不作为主路径必需条件。

## 4. 网络事件模型

每个实际 HTTP Request 形成一条最终 `kind=network` 事件。推荐字段：

```json
{
  "kind": "network",
  "type": "fetch",
  "source": "playwright",
  "requestId": "net-<sequence>",
  "redirectedFromRequestId": null,
  "clientTime": "<start ISO>",
  "completedTime": "<end ISO>",
  "durationMs": 123,
  "method": "POST",
  "requestUrl": "https://example/api",
  "requestHeaders": {},
  "requestContentType": "application/json",
  "requestBody": "{}",
  "requestSize": 2,
  "requestBodyTruncated": false,
  "status": 200,
  "responseHeaders": {},
  "responseContentType": "application/json",
  "responseBody": "{}",
  "responseSize": 2,
  "responseBodyTruncated": false,
  "failure": null,
  "context": {
    "pageUrl": "https://example/form",
    "frameUrl": "https://example/form",
    "frameDepth": 0,
    "serviceWorkerUrl": null
  }
}
```

兼容约束：

- 老事件的 `url`、`frame`、`error` 字段仍可被转换器读取。
- 新失败事件同时提供结构化 `failure`；转换器兼容旧 `error`。
- HTTP 4xx/5xx 属于有 response 的完成请求，不记为 transport failure。
- redirect 每一跳独立成事件，通过 request ID 关联。

## 5. Body 处理

### 字节限制

- 默认 `MAX_NETWORK_BODY_BYTES = 20 * 1024 * 1024`，request body 与 response body 分别应用该上限。
- Buffer 先按字节截断，再删除末尾无效 UTF-8 continuation，保证输出合法 UTF-8 且不超过上限。
- `size` 表示截断前字节数，`truncated` 表示原始值是否超过上限。

### 内容分类

- 文本：`text/*`、JSON、XML、JavaScript、GraphQL、form-urlencoded 等明确文本 Content-Type。
- 二进制：图片、字体、音视频、压缩包、octet-stream 等，只保存大小、类型和 `BodySkipped` 原因。
- 无 Content-Type 时采用保守判断：请求 body 可在小范围内验证 UTF-8/可打印比例后记录；响应默认不猜测为文本。
- multipart 不保存原始 body。仅在 boundary 和 part headers 可可靠解析时输出普通字段与文件元数据；否则记录总大小和 `multipart-unparsed`。

敏感 headers 和正文不脱敏，产物仅保存在本地会话目录。

## 6. Recorder 自身流量过滤

过滤发生在 request 初始事件处，不进入 WeakMap：

- URL host 为 localhost、127.0.0.1、`[::1]` 或 logger 实际监听地址。
- 端口等于当前 logger 端口。
- path 为 `/log`、`/events`、`/dashboard`、`/dashboard.html`、`/health` 或 `/control/*`。

同时要求端口由 logger、inject 回退路径、Dashboard 和 control client 共享配置来源，避免继续依赖三处手工同步常量。

## 7. 页面感知协议

`observe` 请求示例：

```json
{
  "index": 0,
  "includeText": true,
  "includeAria": true,
  "includeElements": true,
  "screenshot": true,
  "dom": false,
  "fullPage": false
}
```

响应包含：

- page index、URL、title、viewport。
- frame 列表：index、URL、name、父 frame index。
- 有界可见文本摘要及截断元数据。
- 每个 frame 的有界 ARIA snapshot。
- 可交互元素摘要：tag、role、accessible name、type、value、state、bounding box，以及可直接回传给 action 的 target 描述。
- screenshot/DOM 不使用 base64 塞入 JSON；保存到当前会话 `artifacts/observe-<timestamp>/`，响应返回本地绝对路径和大小。

默认限制建议：

- 可见文本 64 KiB。
- 单 frame ARIA snapshot 64 KiB。
- 交互元素最多 500 个，每个字符串字段有长度限制。
- DOM 仅显式请求时落盘，不默认进入响应。

## 8. 操作协议

统一请求结构：

```json
{
  "index": 0,
  "frame": { "index": 0 },
  "target": { "role": "button", "name": "提交", "exact": true },
  "timeoutMs": 10000
}
```

target 必须且只能提供一种主定位策略：

- `selector`
- `role` + 可选 `name`
- `text`
- `label`
- `placeholder`
- `testId`

可选 `nth` 用于调用方已明确接受多匹配时选择序号。未给 `nth` 且存在多个可见匹配时返回 `AMBIGUOUS_TARGET`，并附带有限候选摘要。

操作返回：action、page/frame、目标摘要、操作前后 URL、耗时及操作专属结果。主要错误码：

- `BROWSER_NOT_READY`
- `PAGE_NOT_FOUND`
- `FRAME_NOT_FOUND`
- `INVALID_TARGET`
- `TARGET_NOT_FOUND`
- `AMBIGUOUS_TARGET`
- `TARGET_NOT_ACTIONABLE`
- `ACTION_TIMEOUT`
- `ACTION_FAILED`

AI 在用户授权目标内循环调用 observe 和 action；Skill 不内置动作类型确认清单。

## 9. HTTP 本地边界

- 不增加令牌，继续监听 `0.0.0.0:7777`。
- `/log` 接受来自目标页面的跨域 POST，并只返回最小响应。
- `/control/*` 和感知接口：
  - 无 Origin 的本机 CLI/AI 请求允许。
  - 有 Origin 时，仅允许 Origin 与请求 Host 同源，或 localhost/loopback 同源。
  - 其他 Origin 和对应 OPTIONS 预检返回 403。
- 文档明确端口只能用于可信本机或可信局域网，不能端口转发到公网。

## 10. Trace 展示

JSONL 每个 request/response body 最多保存 20 MiB；trace 默认只内联较小摘要，避免 markdown 体积失控：

- 默认每个 body 最多展示 16 KiB。
- headers 完整展示，但设置单字段和整体输出保护。
- 超限时标注原始 size、捕获截断、trace 展示截断和 `jsonlLine` 反查命令。
- JSON body 可在可解析时格式化；解析失败按原文本代码块展示。
- 老版 network 事件继续使用现有渲染路径。

## 11. 兼容与发布

- 不迁移历史 JSONL。
- Dashboard 保留现有页面/导航行为，并可增补 observe 与基础操作入口，但 UI 不是 AI API 的唯一入口。
- `.common/.claude` 与 `.common/.codex` 必须包含相同文件和内容。
- skill-garden 真实源提交后，Flower 根仓库更新 submodule pin 并运行 `npm run sync`，确保 `enhancements/MANIFEST.json` 的 `sourceCommit` 正确。

### 11.1 运行时目录迁移

- `run.sh` 把依赖安装到 `$CRAFT_RPA_HOME/runtime/recorder`，并通过 `CRAFT_RPA_PLAYWRIGHT_MODULE` 让受管目录中的 `launch.js` 精确加载该运行时依赖，避免跨平台 `NODE_PATH` 分隔符差异。
- `CRAFT_RPA_PROFILE_DIR`、`CRAFT_RPA_SESSION_FILE`、`CRAFT_RPA_SESSION_DIR` 显式传给 `launch.js`，不再依赖 `recorder/profile` 与 `recorder/session.jsonl` 软链。
- 新版首次启动只按精确名称处理旧 `recorder/profile`、`recorder/session.jsonl` 和 `recorder/node_modules`：软链只删除链接本身，普通旧文件/目录继续按既有归档规则保留数据。
- Flower builtin content adapter 在扫描已安装 common `craft-rpa` 时跳过上述三个已登记运行时路径，且在判断前不对路径执行 `stat`，从而允许旧安装进入更新事务但不削弱 canonical source tree 校验。

## 12. 回滚

- 网络采集、controller 和 client 为新增模块；回滚可恢复 `launch.js/logger.js/inject.js/run.sh/jsonl-to-trace.js/SKILL.md` 并删除新增模块与测试。
- JSONL 新字段是向后兼容扩展，回滚代码后已生成会话仍可由旧转换器读取基础字段，只会忽略新增内容。
- 不修改 profile 或历史 sessions，回滚不需要数据迁移。
