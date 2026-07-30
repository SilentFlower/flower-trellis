# 升级 Craft RPA 网络采集与可复现追踪

## Goal

升级 `craft-rpa` 的网络录制能力，使真实浏览器流程中的 Fetch/XHR 请求能够被完整、稳定地留档，并让后续 AI 或 RPA 工程师仅依赖会话产物即可分析关键接口、还原请求条件和定位失败原因。

## Background

- 当前实现通过页面内 Hook `window.fetch` / `XMLHttpRequest` 记录 method、URL、status 和 duration，无法稳定覆盖跨域 iframe、Service Worker、微前端隔离上下文及页面未成功注入的请求。
- 桌面原型 `/mnt/c/Users/SilentFlower/Desktop/craft-rpa` 已验证 Playwright context 级采集方向，但尚未形成完整实现：只监听 `response`、未处理 `requestfailed`、未排除 recorder 自身请求，并且新增字段未接入 trace 转换。
- 当前转换器在 `vendor/skill-garden/.common/.claude/skills/craft-rpa/scripts/jsonl-to-trace.js:582` 只渲染 method、requestUrl、status、duration 和 error，无法展示新网络内容。
- `vendor/skill-garden/.common/.claude` 与 `.common/.codex` 的 `craft-rpa` 当前内容一致，升级后必须继续保持双副本逐字节同步。
- `vendor/skill-garden/.common` 是真实源；Flower 的 `enhancements/common` 是通过 `npm run sync` 生成的快照，不允许只修改快照。

## Requirements

### R1. 上下文级网络采集

- 使用 Playwright BrowserContext/Page 网络事件作为 Fetch/XHR 的主要采集来源，覆盖主页面、同源/跨域 iframe、微前端及 Playwright 可观察到的 Service Worker 请求。
- 页面注入脚本继续负责交互、导航和异常事件，不再通过修改业务页面的 `fetch` / `XMLHttpRequest` 产生重复网络记录。
- 每个真实 Fetch/XHR 最多生成一条最终网络事件；重定向链可按每个 HTTP 请求分别记录，但必须保留关联信息。
- 必须排除 `craft-rpa` 自身的 `/log`、Dashboard 轮询和 `/control/*` 请求，避免递归或日志污染。

### R2. 完整请求生命周期

- 成功响应、HTTP 4xx/5xx、无响应失败、超时、DNS/连接/CORS 类失败都必须形成可区分的网络事件。
- 网络事件保留请求开始时间、完成时间或持续时长、method、URL、resource type、状态码、失败原因和来源上下文。
- 页面、frame 和 Service Worker 无 frame 场景必须使用明确且兼容的上下文字段，不伪造 frame 深度。

### R3. 请求与响应内容

- 文本类请求/响应保存 Content-Type、大小、body、是否截断和捕获错误。
- body 限额按 UTF-8 字节数执行，而不是按 JavaScript 字符数近似；默认单方向最大值暂定为 1 MiB。
- JSON、XML、纯文本、JavaScript、表单编码等文本内容可记录；图片、字体、音视频及其他二进制内容只记录类型、大小和跳过原因。
- multipart/FormData 不保存文件二进制内容；普通字段与文件名、MIME、大小等元数据在可可靠解析时记录，无法可靠解析时明确标记限制，不伪造结果。
- 请求与响应使用 Playwright 可提供的完整 headers 集合，不能把 `request.headers()` 描述为完整集合。
- Authorization、Cookie、Set-Cookie、token、密码及请求/响应 body 中的其他敏感内容默认原样保存，以满足本地复现需要；产物仅保存在本地 `.craft-rpa/`，必须继续通过 `.gitignore` 避免进入版本库，并在 `SKILL.md` 明确提示不得未经检查外传。

### R4. 事件传输可靠性

- 注入脚本产生的交互、导航和异常事件优先通过 Playwright 暴露给所有 frame 的本地 binding 直接写入 logger，不再以目标页面访问 localhost 作为正常主路径。
- HTTP `/log` 仅作为 binding 不可用时的兼容回退；回退时优先使用 `sendBeacon`，必须遵守 keepalive/beacon 大小限制，并使用不会递归进入网络采集的原生发送路径。
- 页面卸载时无法可靠发送的大批量回退事件必须有清晰的降级行为，不能静默声称已持久化。
- 正常主路径不应依赖关闭 Chrome Private Network Access 或其他大范围安全特性；CORS/PNA 响应头只服务兼容回退和本地 Dashboard 边界。

### R5. JSONL 与 Trace 契约

- `session.jsonl` 保留足以复现请求的原始网络字段，并继续维持“一行一个事件”的兼容格式。
- `jsonl-to-trace.js` 必须识别并渲染新增网络字段；较大 body 不得无上限撑爆 `trace.md`，应展示可读摘要、截断状态和 `jsonlLine` 原文定位方式。
- 老版本 session 仅包含基础网络字段时仍可正常转换，不要求迁移历史 JSONL。
- `SKILL.md` 对采集范围、敏感数据、二进制、截断和 trace 展示的说明必须与实际行为一致。

### R6. AI 页面感知与浏览器控制

- 将桌面原型的 `/control/click` 纳入正式能力，并扩展为可供 AI 调用的页面感知与基础操作接口，使 AI 能在用户授权的录制浏览器中查看真实页面状态、执行操作并依据结果继续分析。
- 页面感知至少应覆盖当前 tab/page 列表、URL、标题、可见页面文本、可交互元素摘要、frame 信息、页面截图和必要的 DOM/HTML 快照；输出必须有大小边界，不能无上限返回整页数据。
- 基础操作至少评估 click、fill/type、press、select、check/uncheck、focus、navigate、reload、back、forward、打开/关闭/切换 tab，并统一 selector/text/role 等目标描述、超时和错误返回结构。
- 操作接口必须复用 Playwright locator/actionability 语义，支持在可识别 frame 中执行，并返回实际命中的页面、frame、元素摘要和操作后 URL；不得静默点击任意第一个模糊匹配。
- Dashboard 可以继续服务人工观察和控制；AI API 与 Dashboard 共用同一 browser controller 契约，避免形成两套实现。
- 控制和感知接口只服务当前本地录制会话，不设计远程多租户、跨机器调度或无人值守集群能力。
- 采用目标级连续执行模型：用户授权一个浏览器目标后，AI 可以循环执行“感知页面、选择动作、操作、验证结果”，无需对每次点击、填写或提交单独确认。
- Skill 不按付款、提交、发送、创建或删除等动作类型设置固定二次确认清单；只在目标或目标对象无法从用户授权中合理确定、操作即将超出当前授权范围，或底层平台本身要求权限确认时暂停询问。
- 控制与页面感知 API 继续使用无令牌的本地 HTTP 接口，并保留 `0.0.0.0:7777` 监听以支持 WSL 与 Windows 主机互访；使用前提是运行机器和本地网络环境可信。
- `/log` 所需的跨域接收策略与 `/control/*`、页面感知接口分离；被录制的第三方网页不得仅凭跨域脚本直接调用浏览器控制接口。此边界不等同于网络鉴权，`SKILL.md` 仍需明确禁止把端口暴露到公网或不可信局域网。
- `SKILL.md` 必须给出 AI 可直接执行的调用约定、建议的感知后操作流程，以及用户明确要求停止或关闭浏览器时的边界。

### R7. 源与分发同步

- 修改 `vendor/skill-garden/.common/.claude/skills/craft-rpa` 与 `.common/.codex/skills/craft-rpa` 的对应文件，并验证两份内容一致。
- 通过 Flower 根仓库 `npm run sync` 更新 `enhancements/common` 和 `MANIFEST.json`，保持真实源、发布快照和已安装平台语义一致。
- 不修改 `old` / `0.5` Trellis 工作流强化内容；本任务只升级 common skill。

### R8. 可验证性

- 为网络事件聚合、成功/失败生命周期、body 截断、二进制跳过、自身请求过滤、旧 JSONL 兼容和 trace 渲染增加可重复的自动化验证。
- 验证不得依赖人工操作真实第三方站点；可使用本地 HTTP 服务和 Playwright 页面构造覆盖场景。
- 新增公共函数或可复用模块需要符合项目 JSDoc 约束；维护性注释使用中文并解释非显然设计原因。

## Acceptance Criteria

- [ ] 本地测试页面发起成功 Fetch、成功 XHR、HTTP 500 和连接失败请求时，JSONL 各产生一条结构正确且可区分的网络事件。
- [ ] 跨域 iframe 或隔离页面中的 Fetch/XHR 能被采集，且不会因页面 Hook 缺失而漏记。
- [ ] recorder 自身 `/log`、`/events`、Dashboard 和 `/control/*` 流量不进入业务网络事件。
- [ ] 文本 request/response body、headers、Content-Type、字节大小和截断标记按契约落盘；二进制内容不落原始 body。
- [ ] 多字节文本的 body 上限按 UTF-8 字节准确执行，实际落盘内容不超过配置上限。
- [ ] 无 response 的失败请求保留失败原因和 duration；成功请求保留 status 和响应捕获结果。
- [ ] 新旧两种 JSONL 均能转换为 trace；新 trace 可看到网络摘要并通过 `jsonlLine` 定位完整原始字段。
- [ ] AI 能通过稳定接口获取当前页面、frame、可交互元素和截图/DOM 摘要，并据此完成 click、fill/type、press、select 和 tab/navigation 基础操作。
- [ ] 控制操作对无匹配、多匹配、不可见、不可操作、超时和跨 frame 场景返回结构化结果，不静默误操作。
- [ ] 用户授权目标后，AI 能连续完成多步感知、操作和验证流程，不要求逐操作确认，同时不会越出已授权目标和对象范围。
- [ ] API 不引入会话令牌；Dashboard 与本机 AI 客户端可直接调用，同时第三方被录制页面的跨域脚本不能直接调用控制与感知接口。
- [ ] `.claude` 与 `.codex` 两份 skill 内容一致，Flower `enhancements/common` 快照由真实源同步生成。
- [ ] `node --check`、新增针对性测试以及适用的 Flower 根仓库检查通过。
- [ ] `SKILL.md` 的行为说明与测试证明的实际能力一致，不再声明未实现的 FormData、headers 或 body 行为。

## Out of Scope

- 自动生成可直接执行的 RPA 脚本。
- 采集 WebSocket 消息、EventSource 数据流或普通静态资源 body。
- 对任意 multipart 格式实现通用二进制解析器。
- 跨机器浏览器调度、多用户并发控制或通用远程桌面能力。
- 修改历史 session 数据或将旧 JSONL 批量迁移为新格式。
