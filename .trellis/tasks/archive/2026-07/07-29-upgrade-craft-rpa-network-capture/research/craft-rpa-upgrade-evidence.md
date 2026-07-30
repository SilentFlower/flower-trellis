# Craft RPA 升级证据

## 当前实现

- `vendor/skill-garden/.common/.claude/skills/craft-rpa/recorder/launch.js` 内联定义 browser controller，目前只支持 open、pages、close、focus、reload、back、forward 和 navigate。
- `recorder/logger.js` 将 `/control/*` 映射到 browser controller，并监听 `0.0.0.0:7777`；当前 CORS/PNA 响应头对所有路由统一设置。
- `recorder/inject.js` 通过修改页面内 `window.fetch` 和 `XMLHttpRequest` 记录基础网络字段，因此受注入上下文和页面脚本隔离影响。
- `scripts/jsonl-to-trace.js:582` 只渲染 method、requestUrl、status、durationMs 和 error。
- `scripts/run.sh` 负责会话目录、软链、进程和 trace 转换，是 AI 调用的稳定入口。
- `.common/.claude` 与 `.common/.codex` 当前逐字节一致；Flower 根仓库 `npm run sync` 将 `.common` 复制到 `enhancements/common/.common`。

## 桌面原型提供的方向

参考目录：`/mnt/c/Users/SilentFlower/Desktop/craft-rpa`。

- 新增 Playwright `context.on('response')`，可绕开页面 Hook 的上下文覆盖问题。
- 新增 request/response body、headers、Content-Type、大小与截断字段。
- 新增 `/control/click` 和 selector/text 定位。
- 改进注入事件发送：大于约 60 KiB 时不再强行使用 sendBeacon/keepalive。

原型不能直接合并的原因：

- 只监听 `response`，无 response 的失败请求丢失，并且不再保留 durationMs。
- 未排除 `/log` 自身请求，fetch 回退时可能将日志上传请求再次记入 JSONL。
- 活跃路径无条件保存 `request.postData()`，与“二进制跳过、FormData 文件只记元数据”的文档不一致。
- body 大小按字节计算但按字符截断，多字节内容可能超过 1 MiB。
- 使用 `request.headers()`，不包含 Playwright 文档所述的 Cookie 等安全相关 header。
- `jsonl-to-trace.js` 未渲染新增字段。
- `/control/click` 对多匹配选择第一个可见元素，可能静默误操作。

## Playwright 1.60 可用能力

`recorder/package-lock.json` 当前锁定 Playwright 与 playwright-core 1.60.0。本地类型定义确认：

- BrowserContext 支持 `request`、`response`、`requestfinished`、`requestfailed` 生命周期事件。
- `Request.allHeaders()` 提供包含 Cookie 信息的完整请求 headers；`Request.headers()` 明确不包含安全相关 headers。
- `Request.postDataBuffer()` 可读取二进制形式的请求 body；`Request.postDataJSON()` 只适用于 JSON 和表单编码的结构化读取。
- `Request.failure()` 提供失败原因；`Request.serviceWorker()` 可区分无 frame 的 Service Worker 请求。
- `Response.allHeaders()` 与 `Response.body()` 可在请求完成后读取完整响应信息。
- Page/Locator 提供 screenshot 与 ariaSnapshot，可作为 AI 页面感知的基础能力。

## 推荐实现边界

### 网络生命周期

- 新建独立网络采集模块，由 `launch.js` 在 BrowserContext 上安装监听。
- 使用 WeakMap 保存每个 Request 的开始时间、请求 ID、重定向关系和待完成状态。
- `requestfinished` 生成成功/HTTP 错误事件，`requestfailed` 生成传输失败事件；两条终态路径共享一次性 finalize 门禁，确保每个请求只落一条最终事件。
- 只采集 resourceType 为 fetch/xhr 的请求，并在最早阶段过滤 recorder 自身端口和路径。
- response body 在 requestfinished 后读取；读取失败保留 captureError，不丢整条网络事件。

### Body 与 headers

- headers 使用 `allHeaders()`；字段原样保存，不做默认脱敏。
- body 截断使用 Buffer 字节切片并避免截断到无效 UTF-8 尾部。
- 文本 Content-Type 保存正文；明确二进制类型只保存大小、类型和跳过原因。
- multipart 默认不保存原始 payload；可做边界明确的 best-effort 元数据解析，解析失败时只保存总大小和限制原因。

### 页面感知与操作

- 新建 browser controller 模块，保留既有 tab/navigation 方法并增加 observe、click、fill、type、press、select、check/uncheck。
- observe 返回有界 JSON：页面/frames、可见文本摘要、交互元素摘要和 ARIA snapshot；截图与 DOM 保存到当前 session 的 artifacts 目录，API 返回本地路径。
- target 契约支持 selector、role+name、text、label、placeholder、testId 之一，并支持 pageIndex、frameIndex/frameUrl 与显式 nth。
- 默认多匹配返回结构化 `AMBIGUOUS_TARGET`，只有调用方显式传 nth 时才选择具体元素。
- 每个操作返回实际页面、frame、目标摘要、操作前后 URL 和错误码，便于 AI 继续观察与验证。

### HTTP 与本地边界

- 保持无令牌、`0.0.0.0:7777` 的本地使用模型。
- `/log` 继续允许第三方页面跨域写入；`/control/*` 不复用该开放 CORS 策略。
- 对带 Origin 的控制请求，仅允许 Origin 与当前 Host 同源或 localhost/loopback；无 Origin 的本机 CLI/AI HTTP 调用继续允许。
- 该规则减少被录制网页直接调用控制接口的风险，但不宣称构成网络鉴权。

### 测试与分发

- 使用 Node 内置 `node:test`，对网络聚合、UTF-8 截断、类型判断、multipart 限制、自身请求过滤、目标解析、歧义错误和 trace 渲染做可重复测试。
- 浏览器集成测试使用本地 HTTP server；若 CI 无浏览器，可把纯逻辑覆盖设为必跑，并提供检测到可用 Chrome/Chromium 时执行的 Playwright smoke test。
- 先在 `.common/.claude` 完成实现与测试，再机械同步到 `.common/.codex` 并校验逐字节一致。
- Flower 根仓库运行 `npm run sync` 后验证 `enhancements/common` 与 skill-garden 真实源一致；skill-garden 提交后需再次同步，保证 MANIFEST `sourceCommit` 指向包含本改动的提交。
