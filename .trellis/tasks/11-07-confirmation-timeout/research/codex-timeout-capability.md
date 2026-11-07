# Research: Codex 会话内限时确认能力与退出边界

> 后续实验更新：本文保留初次只读研究的时间范围。2026-11-07 已另外运行隔离原生 CLI 探针，当前实际结果以 [native-background-results.md](native-background-results.md) 为准；下文“未运行”只描述初次只读核查，不能当作最新实验状态。

- Query: Codex 现有 TUI / host 能否通过原生询问、MCP 表单或生命周期 hook，实现人工优先、超时继续、关闭主窗口立即取消且不恢复旧事项。
- Scope: mixed；官方 OpenAI 文档、本机已有 CLI 与源码只读核查。
- Date: 2026-11-07
- 阶段：`.trellis/workflow.md` Phase 1.2；本任务仍为 `planning`。本文只有能力核查与候选设计，没有实施批准。

## Findings

### 1. 结论与证据等级

1. **已证实：Codex 有可用的原生扩展入口。** 官方文档列出 MCP `elicitation/create` 的宿主转发接口，以及 `Stop`、`UserPromptSubmit`、`Interrupt`、`SessionEnd` hooks。本机 CLI 版本是 **0.167.0**，二进制还内嵌了 Stop / Interrupt / SessionEnd 的 JSON Schema，见第 3、4 节。
2. **已证实：当前模型侧 `request_user_input` schema 没有 timeout 参数。** 不得给该工具拼接 `timeout`、`timeoutMs` 或 `autoResolutionMs`。官方文档中的 `autoResolutionMs` 位于宿主收到的 `item/tool/requestUserInput` 请求，不能据此推导模型可设置该字段。
3. **未证实：只安装一个 MCP server，就能在本机原 TUI 同时满足三项交互验收。** 服务端可以计时并取消 elicitation，但尚无本机证据证明取消会立即移除 TUI 表单、解除宿主等待，并让原工具结果进入同一活动回合。MCP 管道连着后台 daemon，也不能证明用户窗口仍在。
4. **已证实：同步 Stop hook 能触发继续，不需要 queue。** 返回 `decision: "block"` 和 `reason`，Codex 会生成 continuation prompt。**未证实：Stop 等待期间人工输入何时触发 UserPromptSubmit、是否先排队，以及 continuation 前如何竞争。** 不能把 UserPromptSubmit 当作已经验证的即时取消信号。
5. **已证实：SessionEnd 不能覆盖 daemon 模式的即时窗口退出边界。** 切走会话或 `thread/unsubscribe` 不会立即结束 session；无客户端打开的空闲会话可以到 30 分钟后才触发 SessionEnd。它只能补充清理，不能单独承担窗口存活判断。
6. **建议候选：前台启动器 + `codex --no-daemon` + IPC + 同步 Stop command。** 不修改 Codex 源码、不新增 MCP；由启动器先于 TUI 转发捕获人工输入，独立撤销旧待决，再通过活 IPC 向 Stop 提供一次性超时许可。这个方案需要新增启动入口，**须用户选择，不能视为既定范围**。完成第 8 节真实验证前，不应默认启用自动策略。

这里的“已证实”只表示文档或本地只读证据成立；没有进行真实模型回合、当前用户线程唤醒、TUI 交互或退出实验。本文也没有断言 Stop continuation 必然保留相同的 wire `turnId`；若必须严格保持同一回合 ID，需要另行观察事件。

### 2. 找到的文件与本地版本

| 文件 | 说明与定位 |
| --- | --- |
| `.trellis/tasks/11-07-confirmation-timeout/prd.md` | R2/R3/R4/R6/R7/R11 规定授权、人工优先、退出取消和上线前验证。 |
| `.trellis/tasks/11-07-confirmation-timeout/research/constraints-and-harness.md` | 当前约束与禁止 queue 恢复的前序研究。 |
| `.trellis/workflow.md:457` | Phase 1.2 允许外部研究，要求结论落入当前任务 research。 |
| `.codex/hooks.json:3` | 当前登记 UserPromptSubmit；`:24` 登记 SubagentStart；`:36` 登记 SessionStart。当前没有登记 Stop / Interrupt / SessionEnd，**不代表 Codex 不支持这些事件**。 |
| `src/lib/trellis-runner.js:116` | `trellisLaunchArgs()` 只构造 Trellis CLI 启动参数。 |
| `src/lib/trellis-runner.js:183` | `runTrellisPty()` 已有 node-pty 使用模式；`:260` 转发真实终端输入，`:277` 处理子进程退出。它不是现成的 Codex 主会话控制器。 |
| `.agents/skills/trellis-meta/references/customize-local/overview.md:23` | 先核对运行态和所有权；`:29` 规定 Skill-Garden 0.6 作者源与同步流程。 |
| `.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md:185` | 外部 Codex/Claude 格式导入首版只导入 Skill 等被动内容；MCP / hooks / bin 只进兼容报告，不能假定 Flower 普通插件导入已会安装这些主动入口。 |
| `/root/.codex/packages/standalone/releases/0.167.0-x86_64-unknown-linux-musl/codex-package.json:3` | 本机已安装 CLI 精确版本 `0.167.0`；`:6` 指向 `bin/codex`。 |
| `/root/.cargo/git/checkouts/rust-sdk-773cd6d57c4837f3/3e636ca/Cargo.toml:7` | 本地已有 MCP Rust SDK checkout，版本 `3.3.0`，不是已核实的 Codex 内部依赖锁。 |
| 同 SDK `crates/rmcp/src/model.rs:3593` | MCP elicitation 方法常量；`:3631` 定义 form / url wire 参数；`:3770` 定义结果。 |
| 同 SDK `crates/rmcp/src/service/server.rs:792` | 超时方法宏的实际参数；`:900` 实例化 `create_elicitation_with_timeout`。 |
| 同 SDK `crates/rmcp/src/service.rs:549` | 等待响应和超时处理；`:592` 发送取消通知；`:660` 提供显式 cancel。 |
| 同 SDK `crates/rmcp/tests/test_cancelled_response.rs:26` | 已有测试源码描述取消后不应再返回旧请求响应；本研究未执行该测试。 |

只读命令与实际结果：

```text
command -v codex
/root/.local/bin/codex

readlink -f /root/.local/bin/codex
/root/.codex/packages/standalone/releases/0.167.0-x86_64-unknown-linux-musl/bin/codex

codex --version
codex-cli 0.167.0
```

执行过的其余本地命令仅为 `--help`、文件枚举、读取和内嵌 schema 提取。没有执行 `codex` 交互启动、`exec`、`thread/start`、`turn/start`、queue、配置写入、MCP 注册或 Git 操作。

### 3. 原生询问与 MCP 表单的准确接口

#### 3.1 模型询问与宿主询问是不同层

| 接口 | 已证实的参数或行为 | 本任务限制 |
| --- | --- | --- |
| 当前模型工具 `request_user_input` | `questions[]`，问题含 `header`、`id`、`options[]`、`question`；选项含 `label`、`description`。 | 当前提供的 schema 没有任何计时字段。 |
| App Server 发给 host 的 `item/tool/requestUserInput` | 文档明确列出 `autoResolutionMs`，类型为整数毫秒或 `null`；host 可据此自动完成询问。 | 官方没有在所读文档中交代本机普通 Skill / config 如何给某次模型提问设置该值，也没有证明本机 TUI 已实现这套倒计时。 |
| `serverRequest/resolved` | 参数含 `{ threadId, requestId }`；询问被回答或由开始回合、完成、中断清理时发出。 | 这是清理通知，不是窗口存在证明，也不是提交授权。 |

依据：[OpenAI Docs：tool/requestUserInput](https://learn.chatgpt.com/docs/app-server#toolrequestuserinput)。本机二进制确有 `autoResolutionMs` / `auto_resolution_ms` 字符串，但字符串出现不能证明设置入口或实际 UI 行为。

#### 3.2 MCP elicitation

MCP server 在处理工具调用时向 client 发 `elicitation/create`，普通 form 参数为 `mode: "form"`、`message`、`requestedSchema`，可带协议 `_meta`。本地 SDK 的 form 参数定义没有 timeout 字段。普通 schema 是对象及简单字段，可以让用户选择一个 enum，也可另设字符串承接调整意见。

Codex App Server 再向用户 host 转发 `mcpServer/elicitation/request`：

- 共通关联字段：`threadId`、可选 `turnId`、`serverName`。
- 表单：`mode: "form"` 或 `"openai/form"`，加 `message`、`requestedSchema`。
- URL：`mode: "url"`，加 `message`、`url`、`elicitationId`。
- host 回应：`action: "accept"` 配合 `content`；或 `action: "decline" | "cancel"` 配合 `content: null`。
- 若采用 `openai/form`，host 的 initialize capability 必须显式启用 `mcpServerOpenaiFormElicitation`。

依据：[OpenAI Docs：MCP server elicitation requests](https://learn.chatgpt.com/docs/app-server#mcp-server-elicitation-requests)。**不能把 form 的“默认字段值”或 `cancel` 回应解释为已授权的超时选择。** 超时来源必须由自己的控制器记录。

本地 SDK 3.3.0 的确切服务端入口为：

```text
Peer<RoleServer>::create_elicitation_with_timeout(
    &self,
    params: ElicitRequestParams,
    timeout: Option<std::time::Duration>,
) -> Result<ElicitResult, ServiceError>
```

该 `timeout` 是 SDK 本地等待选项，**不是 wire form 参数**。`service.rs:558` 到时返回 `ServiceError::Timeout`，`:592` 发送 `notifications/cancelled`，内含 `requestId` 和 `reason`；`:660` 的 `RequestHandle::cancel()` 也发送同类取消。SDK 的 `CallToolResult::structured()` 位于 `model.rs:4000`，可返回带决定来源的结构化工具结果。

但这些本地 SDK 事实只证明服务器一端可以这样实现。**没有证据证明 Codex 0.167.0 的 elicitation handler 收到取消后，会立即取消已转发的 UI 请求并接收后续 tools/call 结果。** 协议取消通知不是远端 UI 已关闭的确认回执；不应以此宣布路径已通过。

若继续验证 MCP 路线，需要额外提供本地 stdio MCP 服务、只在当前活动工具调用中计时的等待工具，以及前台生命周期绑定；不能仅注册服务后认为自然具备窗口退出边界。

安装接口已核实为：`codex mcp add <NAME> -- <COMMAND>...`，或 `--url <URL>`；stdio 支持 `--env <KEY=VALUE>`。配置字段包括 `command`、`args`、`env`、`env_vars`、`cwd`。见[OpenAI Docs：STDIO servers](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)。本文没有执行注册。

`tool_timeout_sec` 默认 60 秒、`startup_timeout_sec` 默认 10 秒，不能拿工具 transport timeout 冒充业务默认选择。对于 MCP tool hook，官方还特别说明等待 elicitation 的时间不计入活动执行 timeout，且 hook 与 server 的较短 timeout 生效。见[配置选项](https://learn.chatgpt.com/docs/extend/mcp#other-configuration-options)和[Hook execution and lifecycle](https://learn.chatgpt.com/docs/hooks#execution-and-lifecycle)。普通 tools/call 的所有计时细节仍需按本机行为核实。

### 4. Stop / Interrupt / SessionEnd 的精确合同

以下输入字段同时由现行官方文档和本机 0.167.0 内嵌 JSON Schema 核对。**SessionEnd 比通常的 common-input 说明更窄：它没有 `turn_id`、`model` 或 `permission_mode`。** 不应自行添加或依赖不存在的字段。

#### 4.1 输入与身份

| Hook | 本机 schema 的必需字段 | 调度和用途 |
| --- | --- | --- |
| Stop | `cwd: string`；`hook_event_name: "Stop"`；`last_assistant_message: string | null`；`model: string`；`permission_mode`；`session_id: string`；`stop_hook_active: boolean`；`transcript_path: string | null`；`turn_id: string`。 | 临近结束时同步运行，可决定 continuation。`stop_hook_active` 表示本轮已被 Stop 继续过。 |
| Interrupt | `cwd`、`hook_event_name: "Interrupt"`、`model`、`permission_mode`、`session_id`、`transcript_path`、`turn_id`，类型同上。 | 仅主线程的活动回合被中断时运行；空闲线程和 subagent 不运行。 |
| SessionEnd | `cwd: string`；`hook_event_name: "SessionEnd"`；`reason: "other"`；`session_id: string`；`transcript_path: string | null`。 | 仅主线程；不能用它取得待取消的 turn ID，必须按本次 launcher + session 的待决表清理。 |
| UserPromptSubmit | 官方列出 `prompt: string`、`turn_id: string`，加 common identity 字段。 | 用户提示即将发送时运行；官方没有说明同步 Stop 等待期间是否即时调度。 |

`permission_mode` 的本机枚举是 `default | acceptEdits | plan | dontAsk | bypassPermissions`。

`session_id` 是 Codex session 身份；官方说明 subagent hooks 可以使用父 session ID。因此待决不能只凭一个 `session_id` 匹配；至少还应核对 launcher 实例、hook 类型、`turn_id`、请求 ID 和方案版本。App Server 用 `threadId`，hooks 用 `session_id`，两层名字不能任意互换；需要关联时由本次入口保存映射。转录文件格式不是稳定 hook 接口，不应解析转录正文来猜用户是否已回复。

官方链接：[Common input fields](https://learn.chatgpt.com/docs/hooks#common-input-fields)、[Stop](https://learn.chatgpt.com/docs/hooks#stop)、[Interrupt](https://learn.chatgpt.com/docs/hooks#interrupt)、[SessionEnd](https://learn.chatgpt.com/docs/hooks#sessionend)、[UserPromptSubmit](https://learn.chatgpt.com/docs/hooks#userpromptsubmit)。

#### 4.2 输出、计时与退出

| Hook | 输出 / 行为 | timeout |
| --- | --- | --- |
| 同步 Stop command | 退出 0 时可返回 JSON。`{"decision":"block","reason":"…"}` 请求继续；也可退出 2，把 continuation 原因写 stderr。普通文本 stdout 无效。 | command hook 默认 **600 秒**，配置 `timeout` 的单位是秒；所读文档没有列出 Stop 的额外最大值，**不能宣称任意大值已实测支持**。 |
| Stop 撤销当前待决 | 对有关联的已取消请求可返回 `{"continue":false,"stopReason":"待决已取消"}`，阻止本次自动继续。某个匹配 Stop 的 `continue:false` 优先于其他 hook 的 continuation。 | 必须在宿主 timeout 前退出；业务等待大于 hook 预算时回到人工，不把 hook 超时当同意。 |
| Interrupt command | 退出 0 无输出，或仅带可选 `systemMessage` 的 JSON；不能阻止中断或重启回合。 | 默认 **1 秒**，允许 **1–3 秒**。只做快速撤销 / 清理，不在此倒计时。 |
| SessionEnd command | 同步、advisory；输出不能继续会话或保持 thread 打开。建议退出 0 无输出。 | 默认 **1 秒**，最多 **3 秒**；即使配置 `async:true` 也同步。 |

Stop 的其余允许字段为 `continue`、`stopReason`、`systemMessage`、`suppressOutput`、`decision`、`reason`；本机 schema 不允许额外字段。`suppressOutput` 当前只解析，未实现；不要依赖它隐藏自动来源。Interrupt 的本机输出 schema 只允许 `systemMessage`。

`async:true` 的后台 hook **不能控制 continuation**；结束时没有活动回合就等下一次人工回合，不会主动启动新 turn。因此不能把后台 Stop/sleep 当作限时确认。见[OpenAI Docs：Run hooks in the background](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background)。

普通 command hook 默认预算与特殊事件上限来自[Config shape](https://learn.chatgpt.com/docs/hooks#config-shape)。Brief 允许按正文长度增加等待，可能超过 600 秒；候选实现必须让已配置 Stop 预算覆盖实际等待加清理余量，或者明确判定该次自动模式不可用，不能静默截短为 600 秒。

本机内嵌 schema 的可复核定位（`bin/codex` 文件内字节偏移，非源代码行）：

| schema title | 偏移 |
| --- | ---: |
| `session-end.command.input` | 264402922 |
| `stop.command.input` | 264411165 |
| `stop.command.output` | 264412424 |
| `interrupt.command.input` | 264413406 |
| `interrupt.command.output` | 264414485 |

核查方式是只读查找 `schema-title + "{"` 后用 JSON decoder 解析，并再次校验对象 `title` 精确匹配；这样不会把 `subagent-stop.command.input` 的后缀误认成主线程 Stop。没有找到 SessionEnd 的输出内嵌 schema，因此其输出边界只按官方文档陈述。

### 5. 窗口、session、daemon 必须分开

- **daemon 模式**：官方明确后台 server 可以跨 CLI 会话存活。MCP stdio 管道、server PID、已加载 thread、健康检查正常，都不足以证明主窗口有效。
- **取消订阅**：`thread/unsubscribe` 后，最后一个订阅者离开，thread 要空闲达默认 60 秒才卸载；设置名是 `thread_unload_delay_secs`。它与 SessionEnd 的 30 分钟边界是不同机制，都不是立即窗口取消。
- **SessionEnd**：正常关闭 Codex、仍打开的会话被 archive/delete、以及上述无窗口空闲条件可以触发。切走会话、unsubscribe、崩溃、SIGKILL、断网均不能被假定具有同一即时回调保证。
- **前台模式**：本机 `codex --help` 明确支持 `--no-daemon`，含义是绕过共享后台 server，即使它已经运行。官方还提供 `[features] daemon_auto_start = false`，但单次启动器优先使用 CLI flag，避免擅自修改全局配置。
- **`--no-daemon` 的证据边界**：已证实绕过 daemon；未实测 TUI 正常关闭 / PTY HUP / 强杀时所有 hook 和子进程的实际结束顺序。不能仅凭 flag 宣布 R4 已验收。

依据：[OpenAI Docs：daemon 与 no-daemon](https://learn.chatgpt.com/docs/environments/network-file-systems#2-stop-codex-on-every-host)、[取消 thread 订阅](https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread)。本机帮助中的 `--remote` 可以连接远程 host，因此候选入口必须排除 `--remote` 和共享 host 路径，不能把远程连接误当自己的前台进程。

### 6. 是否需要修改 harness，安装什么

| 路线 | Codex 源码 | 新增内容 | 当前能否承诺完整需求 |
| --- | --- | --- | --- |
| 只改 Skill / 当前提问文案 | 无 | 规则文字 | **不能**。没有计时与取消实现。 |
| stdio MCP + elicitation | 无 | MCP server、注册配置、工具、前台生命周期绑定 | **待验证**。UI 取消传播和窗口边界都有缺口。 |
| 只加 Stop / SessionEnd hooks | 无 | 受信任 command hooks 和待决状态 | **不能对 daemon 普遍承诺**。原窗口退出与输入调度缺口仍在。 |
| **前台启动器 + IPC + 同步 Stop** | **无** | **新 CLI 启动入口、PTY 生命周期控制、IPC、hook handler、规则接入** | **最小可执行候选**；可绕开输入 hook 调度缺口，仍需真实验证并获用户接受启动方式。 |
| 自建 App Server host | 无，但需开发 host | 自己的前端 / 动态工具或表单 UI | 能把倒计时放在前端；改动范围更大，不作为当前默认建议。 |

候选不需要 Codex 原生插件市场，也不需要额外常驻服务。Codex 可以从项目 `.codex/hooks.json` 或相应 config layer 发现 command hooks；每个新增 / 改变的非托管 hook 必须在 `/hooks` 中按当前定义审核信任，安装本身不等于信任。该要求来自[OpenAI Docs：Review and trust hooks](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)。这里不是本研究要求用户逐次确认待决事项，而是宿主已有的安装边界。

若将来选择原生 Codex plugin，官方支持 `hooks/hooks.json` 和 `mcp.json`，但带 hooks 的插件与公共目录、desktop 手动安装存在额外分发条件；参见[官方插件打包规则](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)。Flower 当前的外部插件格式导入也不会自动安装这些主动能力。不能以“已装一个 Skill 插件”替代启动与生命周期接入。

### 7. 推荐的具体候选：前台启动器 + 同步 Stop，无 MCP

以下是**待用户选择、待实现验证的设计**；命令名、IPC 消息和状态字段均为拟新增的 Flower 接口，不是 Codex 已有参数。

1. **显式前台入口。** 例如新增 `flower-trellis session codex`，启动 `codex --no-daemon --cd <project>`。它拥有 TUI 子进程和 PTY 的整个生命周期，生成随机本次实例身份，建立仅供本次进程使用的 IPC。不得自动附着共享 daemon / remote host。
2. **结构化准备。** 流程在完整展示当前 Brief / 问题报告 / Git 精确计划、默认动作与时长后，登记 `requestId`、方案版本 / 摘要、确认类型、授权来源和预期动作。Stop 收到的 `last_assistant_message` 必须可与展示记录核对；值为 null、正文不匹配、方案改变或身份不符就保持人工。计时不得从准备文件创建开始。
3. **Stop 挂起本次继续。** 同步 command hook 按 `(launcher 实例, session_id, turn_id, requestId, revision)` 连接启动器。启动器确认方案已经输出并显示倒计时说明后，才接受 `armed`，记录单调时钟起点。若不能建立完整展示的确认边界，这次不自动选择。
4. **人工优先独立于 UserPromptSubmit。** 启动器在把真实终端输入转给子 PTY 前，先让该事项变为 `cancelled_by_input`，通知 Stop，再原样转发输入。首版可以保守地把任何人工键入都视为取消自动默认；这可能让滚动 / 导航也取消计时，需作为 UX 取舍说明，不能偷偷把原始按键当成“同意”。UserPromptSubmit 只做补充失效，不承担即时性的唯一保证。
5. **单点竞争。** 超时事件、人工输入、Interrupt、SessionEnd、方案更新、工具重试都进入启动器同一个待决状态机，只允许一次 `armed → decided` 或 `armed → cancelled`。记录 `source=policy_timeout` / `human` / `cancelled`，不能把超时写作用户批准。临界时刻先处理已收到的取消事件；一旦已经开始决定或执行，退出结果按 R5 记录真实状态。
6. **只发原生 continuation。** 只有当前 IPC 有效、TUI 仍属于本实例、方案与授权未变时，Stop 才收到一次性许可，并返回 `{"decision":"block","reason":"Trellis 策略超时事件：按请求及方案版本执行已授权默认动作。"}`。reason 必须标明策略来源及可校验的请求 / 版本，不能写“用户已确认”。模型继续后还要重新核对计划和既有动作前置条件。这里不发送 queue，不调用 thread/resume，不对真实旧线程发消息。
7. **撤销与退出。** 人工输入、暂停、Interrupt、SessionEnd、TUI exit、真实 TTY / PTY 关闭、IPC EOF、启动器异常或授权失效均撤销尚未开始的决定。有关联的 Stop 返回 `continue:false`，不输出 continuation；其他无关 Stop 不建立等待。不可只记录 PID 存活，也不可仅等待 SessionEnd。
8. **强杀也要能关闭许可。** IPC 的生命周期端只能由前台所有者持有，不能被 Codex / hook 后代意外继承而维持假存活。启动器收到 EOF / HUP / 退出时先关闭许可，再中断或终止自己拥有的 TUI。启动器自身遭 SIGKILL 时不能依赖 finally / SessionEnd；要以独立进程退出绑定及 hook 端 IPC 断开拒绝许可，并实测无孤儿自动继续。仅仅调用 node-pty `kill()` 或创建一个进程组不构成已验证保证。
9. **跨次不恢复。** 配置可以持久化，pending 和计时许可只属于本次实例。审计日志可以留盘，但不包含可在启动时重放的授权；手动重开必须生成新实例、新事项。退出时不保留唤醒队列。

建议安装 Stop、Interrupt、SessionEnd、UserPromptSubmit 四类 command hook；SessionStart 可用于宣布当前适配与配置是否有效。清理 hook 只撤销标识和通知 IPC，不执行 git 或任何默认动作。项目受管 hook 的正式修改必须回到 `vendor/skill-garden/.trellis/0.6/` 作者源及相应投影 / Patch，同步编译后再由 Flower 生命周期安装；当前部署副本不是作者源。

普通 `codex`、IDE、desktop、remote、共享 daemon、无可信 IPC、未信任新 hooks、版本未验证、预算不足时均保留人工。用户要求的“具备有效适配时默认开启”，应由完成能力测试后的入口判定，不是每次会话重新索要启用许可。

### 8. 最小验证矩阵与阻塞程度

本轮没有执行下表中的模型或 TUI 实验。只读 schema 核查不足以替代 AC6 的实际验证。可先做纯本地控制器 / 假 PTY / 假 hook 的离线竞态测试；真实 Codex 验证要在后续已授权的隔离实验里进行，不能使用用户现有主线程。

| 实验 | 最小方式与观察 | 是否阻塞自动开启 |
| --- | --- | --- |
| Stop 人工输入调度 | 同步 Stop 等待 5 秒；在第 1 秒真实 TUI 键入 / Enter，记录 Stop、UserPromptSubmit、Interrupt、continuation 顺序。只允许无副作用的回执。确认 native 输入是即时处理、steer 还是排队。 | **是**，如果打算只靠 UserPromptSubmit；使用启动器预先撤销后，不依赖这个调度，但仍要检查人工输入最终可用。 |
| 超时继续 | 通过候选入口展示一项 5 秒默认决定；无输入；检查恰好一次 continuation、来源是 policy_timeout，并读取实际 thread / turn 标识。 | **是**。也决定 Stop 是否满足严格“同一回合”的解释。 |
| 正常退出 | 等待第 1 秒用正常退出关闭 TUI；观察 exit / SessionEnd / IPC，并等待超过原截止时间；不得产生后续模型请求或回执。 | **是**。 |
| 直接关闭终端 / PTY | 第 1 秒真正关闭最外层窗口或关闭测试 PTY master，不能只发送正常退出命令；到期后和手动重开后均无旧执行。 | **是**。 |
| 强杀 TUI | 在等待中对专用测试 TUI 发 SIGKILL，核对 hook 是否成为孤儿、许可是否撤销；不用“SessionEnd 没来”作为继续条件。 | **是**。 |
| 强杀启动器 | 保留专用子 TUI，强杀启动器；检查 IPC 是否立即 EOF、子进程退出绑定是否生效，到期没有 continuation。还要测试连接端被后代错误继承的故障。 | **是**。 |
| daemon 反例 | 未来隔离实例让 daemon 存活，关闭前端；确认配置 / MCP 连接仍在也不会被认作窗口有效。 | **是**，除非首版明确只支持已验证的 no-daemon 前台入口。不能操作当前共享 daemon。 |
| 人工与截止竞争 | 输入在截止前、同一调度片段和截止后各重复测试；观察来源、一次性状态转移、没有双重 continuation。 | **是**。 |
| 内容 / 范围改变 | 在等待期修改方案版本、Git 基线或授权；旧请求不能继续，新请求重新展示 / 计时。 | **是**。 |
| hook 不受信任 / 超时 / IPC 断开 | 新 hooks 未信任、Stop 执行预算不足、JSON 无效、launcher 消失；全部回到人工，不输出默认决定。 | **是**。 |
| MCP form 候选 | 最小 stdio 服务提供一个只返回回执的工具，发送普通 form；分别人工、服务端超时取消、turn interrupt、TUI 关闭。跟踪 elicitation 请求、取消、serverRequest/resolved、工具结果及 UI 是否消失。 | **是**，仅针对 MCP 路线；Stop 路线不需要先解决这一缺口。 |
| 已开始后的退出 | 默认动作以可中断的本地回执步骤代替，开始后退出；记录已完成 / 已中断 / 待核验，不谎报撤销。 | **是**，对应 R5；不需用 commit/push 做首次实验。 |

POSIX 强杀 / HUP 结果不能直接当作 Windows ConPTY 证据。若首版声称跨操作系统支持，就应补充该平台实际进程退出、管道关闭和人工输入测试。若只交付 Linux / WSL 已验证入口，应明确能力边界。

### 9. 相关规范

- `.trellis/workflow.md:265`：planning 不是实施批准；`:457` 规定研究落盘。本任务没有启动实施。
- `.trellis/spec/flower-trellis/cli/index.md`：新 CLI 编排与可复用运行逻辑应按现有分层归位。
- `.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md:185`：外部主动组件不随 Skill 导入自动启用。
- `.trellis/spec/flower-trellis/cli/config-and-state.md:543`：worktree 运行时必须绑定当前分支本地平台入口；不能借共享目录混淆实例。
- `.agents/skills/trellis-meta/references/customize-local/overview.md:23`：受管文件遵循所有权、作者源、同步和 dogfood。

### 10. 补查：background terminal 能否替代前台启动器

补查缘由：用户提出后台终端可能更适合多数 Harness。本节只核对 Codex，不把它推广为其他平台的事实；未启动后台计时进程、模型或真实线程。

**结论：后台终端可以承载计时和进程结果，但目前没有足够证据把它作为“空闲主会话自动继续 + 原窗口关闭即取消”的完整替代方案。** 有完成通知不等于通知会触发下一次模型请求；后台进程存活也不等于窗口存活。当前不能据此取消第 7 节的前台生命周期所有者。

| 层次 / 模式 | 已证实内容 | 未证实内容 |
| --- | --- | --- |
| 模型侧 `exec_command` / `write_stdin` | 本轮提供的工具 schema 中，exec 可以返回运行中的 `session_id`；`write_stdin` 可用空输入轮询该会话，取得输出或退出码。 | 这个 schema 没有承诺 session 结束会唤醒一个已经空闲 / 完结的主回合；也没有承诺主窗口关闭会自动杀进程。不能把 session ID 当成自动通知注册。 |
| CLI background terminals | 官方 `/ps` 展示后台终端及最近输出，且明确要求使用 `unified_exec`，否则列表可能为空。 | `/ps` 是查看状态的 UI 功能，文档没有赋予“到期开始模型回合”的合同。 |
| App Server `command/exec` | 可运行命令，不创建 thread；参数含 `command`、`cwd`、`timeoutMs`、`tty`、`processId`、`streamStdoutStderr`。后者启用 `command/exec/outputDelta`；命令结果含 `exitCode`、`stdout`、`stderr`。 | 文档没有把完成结果关联为主 thread 的自动输入，也没有给出 UI 断开后的自动取消保证。它不创建 thread，不能直接充当当前主会话的续跑入口。 |
| App Server `process/*` | 实验接口，需 `capabilities.experimentalApi = true`；`process/spawn` 接受 `processHandle`，输出走 `process/outputDelta`，完成走 **`process/exited`**；可 `process/kill`。 | 这是发给 host 的通知，官方没有说明它会自动启动模型步骤。该接口在 Codex sandbox 外运行，不能偷换为普通受控 shell 工具。 |
| `thread/backgroundTerminals/*` | 实验接口，需 experimentalApi；`list` 用 `threadId` 和 cursor/limit；`terminate` 用 `threadId`、`processId`；`clean` 用 `threadId` 结束全部后台终端。 | 文档提供显式清理入口，没有声称关闭最后一个前端就必然调用它们。 |

以上官方页均已实际获取：[CLI /ps](https://learn.chatgpt.com/docs/developer-commands#check-background-terminals-with-ps)、[App Server command execution](https://learn.chatgpt.com/docs/app-server#command-execution)、[Process execution](https://learn.chatgpt.com/docs/app-server#process-execution)、[Clean background terminals](https://learn.chatgpt.com/docs/app-server#clean-background-terminals)。关于窗口分离仍适用[daemon 文档](https://learn.chatgpt.com/docs/environments/network-file-systems#2-stop-codex-on-every-host)和第 5 节。

本机版本证据仍为 `codex-package.json:3` 的 0.167.0。只读扫描本机同版本 `bin/codex` 还发现：

- 字节偏移 259292686 附近含 `core/src/unified_exec/async_watcher.rs` 及 `Process exited with code`。
- 字节偏移 259321550 附近含 `Process running with session ID`。
- 字节偏移 262113354 附近含 `process/exited`、`item/commandExecution/outputDelta` 等协议字符串。

这些说明本机确有后台 watcher / 结果 / 事件相关实现材料，**不能从二进制字符串推出 watcher 会创建回合、何时送入模型上下文、或退出时会停止通知**。没有与该二进制匹配的完整源码；未找到上述行为的官方版本门槛，因此不写“从某旧版本起一定支持”。只可声称本机 0.167.0 可见这些接口材料，实际模式还须能力校验。

两种用法必须分开：

1. **保持当前回合活动并轮询后台计时器。** 工具结果可在当前回合返回，从而不需要“唤醒空闲会话”；但仍缺少人工输入抢占和窗口关闭取消的已验证边界。单独增加 sleep / write_stdin 不能补齐这些条件。
2. **结束当前回合，指望后台结束通知自动继续。** 当前没有已证实的 Codex 合同。不能用 queue、resume、持久消息或新建目标来补造这种能力。

如选择继续验证，只需隔离做两个最小实验：先用无副作用后台命令结束后观察 `turn/completed` 之后是否真的出现新的模型请求；再在命令结束前分别关闭前端、保留 daemon / 使用 no-daemon，检查进程、完成事件和模型请求。最后手动重开，确认旧通知不会补跑。**这三项都未验证，分别阻塞空闲续跑与退出取消的自动启用。** 本轮没有执行这些实验。

## Caveats / Not Found

- 没有在本机找到 Codex 自身 Rust 源码或与 0.167.0 匹配的已生成 App Server TypeScript 文件；本研究没有下载源码、生成额外文件或改装 CLI。内嵌 schema 可以证明字段，不能证明运行时调度。
- 没有证据说明 autoResolutionMs 的每次设置来源、Trellis Skill 如何配置它、现有 TUI 的实际默认选择规则，以及窗口断开时的倒计时处理。不能用此字段直接宣布当前提问工具已可限时返回。
- 没有证据证明 MCP 取消通知会向原 TUI 的 elicitation UI 完整传播；本地 SDK 版本不能当成 Codex 客户端实现版本。
- 没有文档保证同步 Stop 等待期间 UserPromptSubmit 先于截止决策执行；该点保留未验证。采用前台输入拦截的候选正是为避免依赖这一假设。
- SessionEnd 的 session 生命周期和主窗口生命周期不等价。正常清理 hook 也不能覆盖 SIGKILL；no-daemon 仅消除共享后台这一层，进程 / 管道退出仍要实测。
- Stop 官方描述保证 continuation，但没有在已读材料中保证 continuation 的 wire turnId 不变。要求严格同一 turnId 时，该项是待决能力点。
- 推荐入口尚未获用户选择，也未实现。现有事实足以支持用户讨论启动方式，不足以支持现在默认开启自动确认。
- 所有外部资料只搜索、打开和引用 OpenAI Docs 的允许域名 `learn.chatgpt.com` / `developers.openai.com`；MCP SDK 依据是本机已有文件，未把第三方博客或搜索摘要作为行为证据。
