# Brief — 升级 Craft RPA 网络采集与可复现追踪

## Goal

- 将 `craft-rpa` 升级为可完整记录 Fetch/XHR 生命周期与正文、并允许 AI 在同一录制浏览器中持续感知、操作和验证页面的本地 RPA 工具。

## Scope

- 以 Playwright BrowserContext 的 request/requestfinished/requestfailed 为网络采集主路径，覆盖主页面、跨域 frame、微前端和可观察的 Service Worker 请求。
- 保存成功、HTTP 错误、重定向和传输失败的 method、URL、duration、完整 headers、文本 request/response body、Content-Type、字节大小、截断状态、失败原因和页面/frame/Service Worker 上下文。
- 按 1 MiB UTF-8 字节上限准确截断文本；二进制不保存原始 body，multipart 仅保存可可靠解析的普通字段和文件元数据。
- 敏感 headers、Cookie、token、密码和正文默认原样保存在本地 `.craft-rpa/`，不做默认脱敏，并明确禁止未经检查外传或提交进 Git。
- 通过 Playwright binding 直接传输交互、导航和异常事件；HTTP `/log` 仅作为 sendBeacon/fetch 兼容回退，正常路径不依赖关闭 Chrome 安全特性。
- 新增统一 browser controller 与本地 `/control/*` API，支持 observe、click、fill、type、press、select、check/uncheck 及现有 tab/navigation 操作。
- observe 返回有界页面/frame、可见文本、ARIA、交互元素摘要；截图和可选 DOM 保存到当前 session artifacts 并返回本地路径。
- 目标定位支持 selector、role/name、text、label、placeholder、testId、frame 和显式 nth；多匹配默认返回结构化歧义错误，不静默操作第一个元素。
- AI 采用目标级连续执行模型，在用户授权目标内循环“感知、操作、验证”，不按动作类型逐次确认。
- 保持无令牌、`0.0.0.0:7777` 的可信本地使用模型；拆分 `/log` 与控制接口 Origin 策略，阻止被录制第三方页面直接跨域调用控制 API。
- 新增零依赖 control client 和 `run.sh control <action> [JSON]`，让 AI 通过稳定 CLI 使用感知与控制能力。
- 扩展 JSONL 与 `jsonl-to-trace.js`，新字段可读且大 body 不撑爆 trace，老版本 session 继续兼容。
- 更新 Dashboard、`SKILL.md`、测试、`.common/.claude` 与 `.common/.codex` 双副本；skill-garden 提交后同步 Flower `enhancements/common` 与 MANIFEST sourceCommit。

## Non-Goals

- 不生成可直接执行的最终 RPA 脚本。
- 不采集 WebSocket、EventSource 或普通静态资源 body。
- 不实现任意 multipart 格式的通用二进制解析器。
- 不提供跨机器调度、多租户并发、通用远程桌面或公网暴露能力。
- 不迁移历史 session JSONL，也不修改既有 profile 和历史会话数据。

## Key Context

- 真实源位于 `vendor/skill-garden/.common/.claude/skills/craft-rpa` 与 `.common/.codex/skills/craft-rpa`；Flower `enhancements/common` 是 `npm run sync` 生成的发布快照，不能单独修改。
- 当前 Playwright lock 为 1.60.0，具备 BrowserContext 网络生命周期、完整 headers、Service Worker 来源、ARIA snapshot 和 screenshot API。
- 桌面原型只监听 response、漏失败请求、未过滤 `/log`、字符截断不等于字节截断、未更新 trace，并且 click 会静默选择首个可见匹配；只能作为方向参考。
- `launch.js` 收敛为编排层；新增 `network-capture.js` 和 `browser-controller.js` 承担可测试逻辑；`logger.js` 继续保持 server `.close()` 兼容并公开 appendEvents。
- recorder 端口与 URL 需要单一配置来源，避免 logger、inject、Dashboard 和 client 多处常量漂移。
- 无鉴权是明确产品决定，依赖可信本机/局域网；Origin 隔离只减少网页脚本误用，不宣称构成网络鉴权。
- skill-garden 与 Flower 根仓库当前均存在其它任务的 dirty 变更，实施和提交时必须保留并排除无关文件。

## Acceptance

- 本地成功 Fetch/XHR、HTTP 500、重定向和连接失败各形成一条结构正确、可区分且有 duration 的网络事件。
- 跨域 frame 请求可采集；recorder 自身 `/log`、events、Dashboard 和 control 流量不进入业务网络事件。
- 文本 body、完整 headers、Content-Type、大小和截断状态准确落盘；多字节文本不超过字节限额，二进制 body 不落盘。
- 新旧 JSONL 均可生成 trace；新增网络字段可读，大正文通过展示上限和 jsonlLine 反查完整原文。
- AI 可观察页面/frame/交互元素及截图/DOM，并连续完成 click、fill/type、press、select、check 和 tab/navigation 操作。
- 无匹配、多匹配、不可操作、超时和 frame 错误返回结构化结果，不发生静默误操作。
- API 无令牌且可由 Dashboard/本机 AI 直接调用；第三方目标页面跨域脚本不能直接调用控制与感知接口。
- recorder 单测、可用浏览器 smoke test、run.sh 基础流程、JS 语法检查、双副本哈希和 Flower 快照一致性检查通过。
- `SKILL.md` 与真实测试行为一致，准确说明敏感数据、body、headers、FormData、AI 连续操作和本地接口边界。

## Next Step

- 用户确认本 Brief 后运行 `task.py start`，再通过 `trellis-route(target=implement)` 进入实现；先完成 skill-garden 真实源和针对性测试，随后处理双副本、跨仓快照同步与 Check-All。
