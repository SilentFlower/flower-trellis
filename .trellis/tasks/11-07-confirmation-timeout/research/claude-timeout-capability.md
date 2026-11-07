# Research: Claude Code 会话内可取消的限时确认

> 后续实验更新：本文保留初次研究的时间范围。2026-11-07 的普通 TUI 自动续接、正常退出、强杀最小场景结果见 [native-background-results.md](native-background-results.md)；下文“未运行”只描述初次核查，不代表最新实验状态。

- Query: 核实 Claude Code 的限时询问、人工输入、到期继续、正常退出与强杀取消能力，并比较项目级 MCP 与前台启动器接入。
- Scope: mixed；本地配置、已安装的官方类型、Claude Code 官方文档、MCP 官方协议与 SDK 源码。
- Date: 2026-11-07
- 阶段与边界：按 `.trellis/workflow.md:455` 的 Phase 1.2 研究；任务仍为 planning。仅运行版本查询、读取文件与官方资料，没有启动模型推理会话、安装 MCP、修改产品配置、唤醒线程或进行 Git 操作。

## Findings

### 1. 结论与证据分级

**Claude Code 有真实的超时和当前回合继续接口；尚无证据证明仅增加项目级配置就完整满足本任务全部合同。** 后续用户建议使用 background terminal，本报告第 9 节已追加核实：普通 Bash 后台命令有完成通知、正常退出清理和不在 resume 时重启的官方依据，值得优先验证免新增启动器的路线。另一候选是“前台启动器拥有 PTY 和会话租约，捕获人工输入，经 IPC 原子取消；同步 Stop hook 等待，到期返回继续决定”。它无需修改 Claude Code 源码、无需新增 MCP，但改变启动方式，必须作为待用户决定的 UX 选项，不能视为已获实施批准。

| 路线 | 已证实能力 | 尚不能满足或证明的要求 |
| --- | --- | --- |
| 原生 `AskUserQuestion` | 有自动继续设置 | 固定枚举、用户或受管作用域、按空闲而非墙钟计时，不支持按事项任意秒数 |
| 普通同步 Stop hook | 在响应结束后等待；返回 `decision: "block"` 和 `reason` 可让当前回合继续 | 不单独提供可并发读取的人工输入通道；不能只用 sleep 证明人工优先与强杀取消 |
| 普通 Bash 后台等待 + hooks | 主对话结束后继续运行；有任务通知；正常退出清理，resume 不重启旧 Bash | 需验证通知自动续接、人工取消竞争、强杀和旧通知处理，详见第 9 节 |
| 项目 stdio MCP + elicitation | 原生表单、SDK 请求超时及取消；弹窗打开时保持前台等待 | 服务端取消后弹窗是否关闭、原工具是否立即返回、到期与人工竞争仍未实测 |
| 前台启动器 + Stop hook | 有官方 hook 合同及现有 PTY 依赖可组合 | 完整方案属工程推断，尚未实测；用户需接受新的启动入口 |
| Cron / `ScheduleWakeup` | 确有原生调度及秒级动态唤醒类型 | 属调度/循环，非确认仲裁；人工取消、恢复及后台会话边界不等价 |

本文“已证实”指官方文档或已安装官方类型直接支持；“推断”指可由公开接口组合的方案；“未验证”指没有真实交互实验，不计为 AC6 通过。

### 2. 本地版本、文件与相关规范

只读运行 `claude --version` 得到 **2.1.293 (Claude Code)**；二进制由 `/root/.nvm/versions/node/v22.23.4/bin/claude` 指向已安装的官方 npm 包。版本另见 `/root/.nvm/versions/node/v22.23.4/lib/node_modules/@anthropic-ai/claude-code/package.json:3`。本机未安装 Python `mcp`、`claude-agent-sdk` 或 `anthropic` 分发包；不能声称已用这些 SDK 验证。

| 文件 | 发现与用途 |
| --- | --- |
| `.claude/settings.json:5` | 当前只登记 SessionStart、PreToolUse、UserPromptSubmit，没有 Stop、SessionEnd、Elicitation 或 ElicitationResult 适配 |
| `.claude/settings.json:65` | 现有 UserPromptSubmit 注入工作流状态；没有确认仲裁与主会话存活证明 |
| `.flower/state.json:505` | `.claude/settings.json` 存在 Flower 托管 Patch 所有权，后续不能只改部署副本 |
| `.agents/skills/trellis-meta/references/local-architecture/overview.md:44` | 持久化作者源为 `vendor/skill-garden/.trellis/0.6/`，随后同步 `enhancements/0.6/`、检查编译产物并更新 dogfood |
| `package.json:5`、`package.json:21` | 项目使用 ESM，已有 `node-pty` 依赖；尚无 MCP SDK 依赖 |
| `src/lib/trellis-runner.js:116` | 当前运行的是 Trellis CLI，不能当成已有 Claude 会话启动器 |
| `src/lib/trellis-runner.js:260` | 有 raw stdin 转发到 PTY 的现成模式；`:277` 有子进程退出与终端恢复模式，可作为工程参考 |
| `.trellis/scripts/decision_log.py:328` | `append_decision()` 是 auto-loop 自主决策接口，要求 run_id 等；不能直接充当交互确认仲裁协议 |
| 已安装官方 `sdk-tools.d.ts:1127` | `AskUserQuestionInput` 的定义；顶层字段为 questions、answers、annotations、metadata，没有逐调用 timeout 字段 |
| 已安装官方 `sdk-tools.d.ts:2892` | `CronCreateInput` 的准确字段及本机版本语义 |
| 已安装官方 `sdk-tools.d.ts:2917` | `ScheduleWakeupInput` 的秒级动态唤醒类型 |

上表 `sdk-tools.d.ts` 均指 `/root/.nvm/versions/node/v22.23.4/lib/node_modules/@anthropic-ai/claude-code/sdk-tools.d.ts`，只读取公开分发类型，没有从私有实现推造公共 API。

相关规范：已读 `AGENTS.md`、`.trellis/workflow.md`、任务 `prd.md` 与 `research/constraints-and-harness.md`；工程入口为 `.trellis/spec/flower-trellis/cli/index.md`，配置与模块约定见同目录 `config-and-state.md`、`module-guidelines.md`。后续实现还应按实际影响读取 Plugin authoring/runtime 规范。本报告不新增已存在配置项或声称候选文件已经存在。

### 3. 原生询问、调度及 hooks 的准确合同

#### 3.1 `AskUserQuestion` 的确有原生自动继续

设置名为 `askUserQuestionTimeout`，类型为字符串枚举 `"60s" | "5m" | "10m" | "never"`，默认 `"never"`，官方作用域为 **User or managed**，不能假定写入项目 `.claude/settings.json` 即生效。到期会提交已经选中的选项，并提示模型按判断继续；不等于执行我们预先绑定的默认动作。原生计时是无输入的空闲时间：按键会重置，终端报告聚焦时暂停；后台会话、读屏模式和连接 Remote Control 时不启动。它仅覆盖该多选问题，权限与计划批准不会因此自动批准。[官方设置条目](https://code.claude.com/docs/en/settings-reference#askuserquestiontimeout)、[官方工具行为](https://code.claude.com/docs/en/tools-reference#question-auto-continue-timeout)。

官方 CHANGELOG 的 2.1.200 记录默认改为不自动继续；因此不能使用旧版默认 60 秒的讨论描述本机行为。[官方版本记录](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21200)。

**判断：真实能力已证实，但不满足三类独立策略、100/130/200 秒、项目默认开关及确定默认动作。** 不建议用未在当前官方文档明确列出的旧环境变量代替公开设置。

#### 3.2 Stop、UserPromptSubmit、SessionEnd

| 事件/配置 | 准确字段或语义 | 本任务用途与限制 |
| --- | --- | --- |
| `Stop` 输入 | `session_id`、`cwd`、`transcript_path` 等公共字段；`stop_hook_active`、`last_assistant_message` | 在主代理结束响应时触发；人工中断不会触发，API 失败改走 StopFailure |
| `Stop` 输出 | 成功退出 0，stdout 单个 JSON 对象：`{"decision":"block","reason":"…"}` | 阻止结束并继续当前回合；不是“终止会话”。`reason` 只表达已由核心决定的下一步 |
| Stop 循环保护 | `stop_hook_active`；官方另有连续继续次数保护 | 必须消费 confirmation_id，不能每次 Stop 重新开同一确认 |
| command hook | `type: "command"`、`command`、可选 `timeout`、`statusMessage` | `timeout` 单位秒；当前文档 command 默认 600 秒；它是宿主取消上限，不是业务默认动作截止时间 |
| `UserPromptSubmit` | 输入有 `prompt`，可返回 `decision: "block"` / `reason` 或 additionalContext | 可做补充失效与审计，不能据此假定等待 Stop 期间输入会立即抵达 |
| `SessionEnd` | 输入 `reason`；含 clear、resume、logout、prompt_input_exit、other | 可做幂等清理，不能阻止退出；没有强杀必达保证 |
| SessionEnd 预算 | 默认共享 1.5 秒；设置文件的 per-hook timeout 可提高预算，文档上限 60 秒；环境变量 `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` | 适合快速失效，不能成为唯一取消路径。插件 hook 的 timeout 不提高整体预算 |

以上接口见[官方 Stop](https://code.claude.com/docs/en/hooks#stop)、[Stop 决策](https://code.claude.com/docs/en/hooks#stop-decision-control)、[hook 字段](https://code.claude.com/docs/en/hooks#common-fields)、[SessionEnd](https://code.claude.com/docs/en/hooks#sessionend)。command hook 达到宿主 timeout 后输出会被丢弃，不能等宿主杀掉 hook 后期待它交付默认决定。[官方超时行为](https://code.claude.com/docs/en/hooks#timeouts)。

官方 interactive-mode 说明：工作期间 Enter 通常入队；Ctrl+Enter 的行为取决于当前工作能否后台化，Esc 用于中断。这不能证明同步 Stop 等待期间 UserPromptSubmit 会在默认决定前并发运行。command hook 的 stdin 是事件 JSON，且没有 controlling terminal，不能从它直接读取 Claude 的交互输入。[官方消息队列](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)、[官方 hook 输入输出](https://code.claude.com/docs/en/hooks#hook-input-and-output)。

**Stop 路线结论：** 当前回合继续有公开依据；普通输入是否排队、Esc/Ctrl+C 是否及时取消正在运行的 Stop、强杀时 hook 的清理，仍需在 2.1.293 和目标终端实测。不要因为官方已修过取消竞争就宣称三者全部通过。官方 2.1.285 的“取消发生在建立过程时 hook 仍启动”修复，只是相关版本证据。[官方版本记录](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21285)。

#### 3.3 Cron 和 `ScheduleWakeup` 是真实接口，但不能当作确认计时器

- 本机 `CronCreateInput`：`cron: string`、`prompt: string`、`recurring?: boolean`、`durable?: boolean`；`CronDeleteInput`：`id: string`。本机类型注释说明 durable 默认 false、仅内存；true 写 `.claude/scheduled_tasks.json`。此为 **2.1.293 的类型证据**，不能外推所有后续版本。
- 当前官方文档使用五字段分钟级 cron，调度只在空闲时提交，可能有抖动；`--resume` / `--continue` 会恢复某些未过期事项。后台化整个会话也能保留循环。因此不能把“session-scoped”理解为“用户窗口关闭就取消且手动重开绝不补跑”。[官方调度合同](https://code.claude.com/docs/en/scheduled-tasks#limitations)。
- 本机 `ScheduleWakeupInput` 确有 `delaySeconds?: number`，运行时限制 60..3600，另有 `reason`、`prompt`、`stop`、`noop`；`stop: true` 停止动态循环。官方将其用于 `/loop` 自定节奏唤醒，非独立确认工具；循环还有回退唤醒行为，不适合未经额外仲裁用于本合同。[官方循环停止行为](https://code.claude.com/docs/en/scheduled-tasks#stop-a-loop)。

**判断：** 不能声称 Claude 没有秒级调度；也不能仅设置 durable:false 就认为 R3/R4/R7 已满足。

### 4. 项目级 MCP elicitation 的可用接口与缺口

#### 4.1 协议与 SDK

MCP 2025-06-18 已引入 elicitation；2025-11-25 的 form 模式请求为 `elicitation/create`，包含 `mode: "form"`、`message`、`requestedSchema`；响应 `action` 为 accept / decline / cancel，accept 可带 content。客户端必须声明 elicitation 能力。**协议没有通用的 `timeoutSeconds`、默认选择或计时开始确认字段。** `elicitationId` 是 URL 模式相关字段，不能假定普通 form hook 总能提供它来关联事项。[官方 elicitation 规范](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)。

可审计的 Node 候选是固定 **`@modelcontextprotocol/sdk` 1.32.2** 的维护线，而非混用 v1/v2 API。官方源码可直接核实：

| 接口 | 已核实参数与行为 | 官方版本化证据 |
| --- | --- | --- |
| `Server.elicitInput(params, options?)` | params 为 form/URL 请求；options 为 RequestOptions | [1.32.2 server/index.ts:538](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/src/server/index.ts#L538) |
| `RequestOptions` | `timeout?: number`（毫秒），`signal?: AbortSignal`，`resetTimeoutOnProgress?: boolean`，`maxTotalTimeout?: number`；默认请求 timeout 60000 毫秒 | [1.32.2 protocol.ts:106](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/src/shared/protocol.ts#L106) |
| 请求到期/Abort | 清理请求回调、发送 `notifications/cancelled`、拒绝 Promise | [1.32.2 protocol.ts:1198](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/src/shared/protocol.ts#L1198) |
| 工具请求取消 | handler 的 `extra.signal`；收到取消时 abort 对应 controller | [1.32.2 protocol.ts:555](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/src/shared/protocol.ts#L555) |
| 连接关闭 | `_onclose()` 清理 timeout、abort 在途 handler | [1.32.2 protocol.ts:649](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/src/shared/protocol.ts#L649) |

注意：此版本 cancel 路径可能把 signal reason 包装为 RequestTimeout。因此不能用“捕获 RequestTimeout”作为默认选择的充分条件；业务核心必须另存 deadline 原因，并先检查人工取消、租约与计划版本。此版本 `StdioServerTransport.start()` 只登记 data/error，不能臆测 stdin EOF 一定自动触发 Protocol.onclose；适配器需明确绑定 end/close、SIGINT/SIGTERM 和写管道失败。[官方 1.32.2 stdio.ts:53](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/src/server/stdio.ts#L53)。

MCP 取消通知接收方是 SHOULD 停止，也可能忽略；它不保证 UI 已关闭或副作用已撤销。[官方取消规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)。

版本边界：当前 TypeScript v2 官方实现明确说明 2026-07-28 不再用 push 式 server→client 请求，需改用 inputRequired 多往返协议；不要把上面的 elicitInput 方案原封不动套到 v2 新协议。[官方 v2.4.0 server.ts:763](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/packages/server/src/server/server.ts#L763)。官方 Python 当前文档为 v2、要求 Python 3.11+；其 async handler 取消支持不等于本地 Claude 弹窗关闭已验证。[Python SDK 版本要求](https://py.sdk.modelcontextprotocol.io/)、[官方 Python 取消](https://py.sdk.modelcontextprotocol.io/handlers/cancellation/)。

#### 4.2 Claude 接入与 Elicitation hooks

Claude Code 2.1.76 的官方 CHANGELOG 已记录 elicitation 与 Elicitation/ElicitationResult hooks；2.1.284 修复这两个事件忽略顶层 decision:block；2.1.287 扩展较旧协议连接的 URL 能力。不能把新文档里所有字段和行为都归给 2.1.76。[官方 CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#2176)。

- 项目 MCP 配置入口为项目根 `.mcp.json` 的 `mcpServers`；stdio 配置可用 type、command、args、env、timeout。项目 hook 在 `.claude/settings.json` 的 hooks；插件可携带 `.mcp.json` 与 `hooks/hooks.json`。[官方项目 MCP 配置](https://code.claude.com/docs/en/mcp#project-scope)、[插件清单](https://code.claude.com/docs/en/plugins-reference)。
- `Elicitation` 在展示对话框之前运行，matcher 匹配 MCP server 名；输入含 mcp_server_name、message，及可选 mode、requested_schema 等。返回 `hookSpecificOutput: {hookEventName: "Elicitation", action: "accept"|"decline"|"cancel", content?: …}` 可跳过对话框；无输出退出 0 则交给用户。**在此 hook 里先等到截止再 accept，会让用户在等待期间看不到原生表单，不能当成完整询问。**[官方 Elicitation](https://code.claude.com/docs/en/hooks#elicitation)。
- `ElicitationResult` 在用户回答之后运行，可观察或修改 action/content；Elicitation hook 已回答时它不运行。不能把它当成与已打开对话框并发的计时回调。[官方 ElicitationResult](https://code.claude.com/docs/en/hooks#elicitationresult)。
- MCP 工具的 `.mcp.json` 每服务器 timeout 与 `MCP_TOOL_TIMEOUT` 是调用上限，单位毫秒；`MCP_TIMEOUT` 用于连接/启动等，均不等于业务默认选择。普通主会话调用默认两分钟后后台化，可用 `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` 关闭，后者自 2.1.212 已有。**官方明确：elicitation 对话框打开期间不会后台化。**[官方 MCP 超时和后台化](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)、[官方环境变量](https://code.claude.com/docs/en/env-vars)。
- 普通长调用转入的后台任务不会跨退出存活，`/tasks` 可停止，但不保证服务器已经停止工作。应使用局部 stdio 服务且只返回决定；不使用远端持续任务代替等待。当前文档的原生 MCP tasks 有另一套跨退出/恢复合同，且要求 2.1.304+，本机 2.1.293 不具备该版本证据。[官方普通调用后台化](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)、[MCP tasks 版本与退出行为](https://code.claude.com/docs/en/mcp#mcp-tasks-that-run-on-the-server)。

**项目级方案判断：** 可以注册本地 stdio MCP 和 hooks，无需改 Claude 源码；不能只改 JSON 就获得业务计时核心。最小候选是同步工具内发 form elicitation，自己的截止计时竞争人工响应；到期取消 elicitation 并返回带来源的默认决定，随后由原主代理继续原流程。是否能在到期取消后关闭弹窗并让原工具立刻完成，是当前阻塞实验，不能用 SDK 超时事实代替。

正常退出时，官方说明 stdio 服务器会被停止：macOS/Linux 先 SIGINT，100ms 后 SIGTERM，再过 400ms SIGKILL；Windows 当前文档说先关 stdin、300ms 后杀进程树，但该顺序是 **2.1.296+**，不能用于证明本机 Windows 行为。强杀 Claude 本身不会保证这套主动清理运行；需通过 EOF/连接与无外部执行能力保障边界。[官方 stdio 停止行为](https://code.claude.com/docs/en/mcp#how-claude-code-stops-a-stdio-server)。

### 5. 可共用的最小候选：前台启动器 + 同步 Stop + IPC

以下是**设计建议，尚未实施或实测**，需要用户先选择是否接受新的前台启动方式。它利用 Claude 官方 Stop 合同，同时绕开“普通 Enter 是否及时进入 hook”的不确定性。

1. Flower 新入口启动一个普通前台 Claude CLI 子进程并拥有 PTY、原始输入、退出事件及私有 IPC；每次启动产生新的随机运行代号。候选入口名称尚未确定，不假装已有命令。禁止后台化、自动 resume 或复用上次待决事项。
2. 完整方案、默认动作、授权依据及秒数已展示后，代理以普通响应结束；Stop 读取 last_assistant_message，与当前展示/计划摘要匹配，再向启动器登记确认。不能在任务创建或方案生成时开始倒计时。展示完成与开始计时需要明确 ACK，单靠 Stop 被触发尚不证明 PTY 文字已全部输出。
3. Stop 的 command hook 同步等待 IPC 结果；启动器在转发有意义的人工输入前先使该事项失效。Esc、Ctrl+C、暂停、修改、取消均走同一原子取消门。首版可保守地把开始输入视为取消自动选择；需区分终端焦点/设备回应等非人工控制序列。
4. 输入使等待返回“已失效/交还人工”，不返回 block。是否需要向 PTY 发送中断，再提交原输入，要在真实终端实验中确定；不能假设 UserPromptSubmit 会帮忙解除 Stop。UserPromptSubmit 仅做补充检查。
5. 到期时核心仅在授权、运行代号、计划摘要、事项状态和连接仍有效时完成一次仲裁。Stop 收到有效决定后退出 0 并打印单个 `decision:block` / `reason` JSON，使**当前回合**继续；等待进程自身不执行实现、修复或 Git，也不发起模型请求。
6. 正常退出先使运行租约和待决事项失效，再清理子进程；强杀启动器或 Claude 时，IPC EOF/PTY 关闭使等待失效。连接断开是取消，不是默认同意。新启动器或手动 resume 必须换代，旧事项只有审计用途。
7. 自动动作开始前仍核对有效计划；进入原实现、检查或 Git 流程，不改变 commit+push / commit-only 模式。开始后的退出按已完成/已中断/待核验记录，不能宣称撤销已发生动作。

配置位置与形式：平台 hook 可部署到 `.claude/settings.json`；若以 Claude 插件发放则使用 `hooks/hooks.json`；项目策略仍由 `.trellis/config.yaml` 中后续设计的键承载。当前文件尚无这些键，不能提前写成现有公共配置。hook 的公开字段只需 type、command、timeout、statusMessage，不要求 MCP。

Stop 的宿主 timeout 必须大于计算出的业务等待时间并留输出余量，业务截止应由核心先触发；例如 200 秒等待可置于 600 秒上限内，但 Brief 可能更长，超过宿主预算时必须重新配置或降级人工，不能静默缩短用户规定的等待。SessionEnd 保持快速幂等取消，不能将长业务等待放进去。

可靠性边界：IPC 活性只能代表启动器仍在。还必须绑定 Claude 子进程、PTY/终端存活与运行代号；后台服务 PID、可恢复 session_id、现有任务指针均不是当前用户窗口证据。启动器本身被 SIGKILL 时不会执行 finally，必须由 hook 的连接丢失及操作前校验补上。Linux/macOS/Windows 的子进程清理不能相互外推。

### 6. 最小实验、阻塞与兼容回退

本轮未执行任何需要模型会话或真实线程的实验。以下只给后续计划；当前不能登记能力校验通过或默认开启自动模式。

| 实验 | 方法与成功证据 | 阻塞/意义 |
| --- | --- | --- |
| Stop 人工选择 | 隔离会话完整展示后等待；截止前键入否决、暂停或修改；比较 raw input、IPC 取消和 hook 返回时间 | 证明不依赖 UserPromptSubmit 并发；任何旧默认继续均失败 |
| Stop 到期继续 | 短时测试再以 100/130/200 秒验证；观察 Stop 成功交付 block/reason，仍为原进程/会话，继续无副作用标记动作 | 证明宿主 timeout 与业务截止区分，无额外模型进程 |
| 中断与退出 | 等待中分别 Esc、Ctrl+C、正常退出、终端关闭、kill Claude、kill 启动器、同时杀；等待超过原截止 | 每个事项应取消且无新动作；不能只检查 SessionEnd 日志 |
| 手动重开 | 在原截止之前和之后 resume 原会话、启动新会话 | 配置可沿用，旧事项不补跑、不再计时 |
| 竞争与重试 | 截止附近人工输入、重复 Stop、工具/IPC 重试、计划摘要变化 | 每个 confirmation_id 只有一个终态；来源区分人工与已授权默认 |
| MCP 关键实验 | stdio 工具发 elicitation；无人回答到期由 SDK 取消；记录取消通知、弹窗关闭、工具返回及原回合继续 | 当前项目级 MCP 路线的核心未知，不通过则不能称免启动器可用 |
| 两分钟边界 | elicitation 打开时等 130/200 秒；另测无弹窗普通长调用及主动 /tasks 停止 | 验证官方的弹窗前台例外及后台任务的实际取消 |
| 已开始动作后退出 | 用可审计无破坏动作分阶段执行，分别在开始前/后退出 | 验证 R5 的状态表达，不能将已发生记录清成未执行 |

第一轮纯进程/IPC 仿真可以不运行模型，但不能替代 AC6 的真实 Claude/Codex 交互验证。第 9 节新增的原生后台候选应先做小范围能力验证；若仍需前台启动器，再由用户决定新的入口。当前没有后续实现批准。未通过能力验证时保持原人工流程，不能用能力不确定性改写用户希望验证通过后默认开启的 R11。

### 7. 与 Codex 共用 Node/Python 核心的建议

建议只实现一份决策规则与仲裁合同，平台 hook 不复制时长、授权、摘要校验和去重规则。以现有 ESM 与 node-pty 条件看，**Node 核心 + Node 启动器 + 薄 Python hook** 是较小候选；也可保留 Python 核心，通过结构化 IPC 供 Node 调用。两者的选型尚未获批准，不需为 Claude Stop 路线引入 MCP SDK 或 Agent SDK。

共享状态建议包含事项标识、类型、方案摘要、运行代号、授权依据、默认动作、显示完成时间、单调截止、状态及决定来源；这些是待设计的内部字段，不是 Claude API。人工、截止、退出、方案变更必须进入同一个仲裁者串行判定，不能让两个进程各自“先读后写”。取消与失联不得变成超时默认，旧运行代号不得重新激活。操作开始前须再次消费有效决定，去重不能只靠“通知已发送”。

SDK 特有差异留在适配器：Claude 使用 Stop stdout JSON；MCP 候选使用 elicitation 与 cancellation；Codex 的具体 hook 行为由独立研究核实。核心输出只选定既有流程下一步，并记录 `human` / `authorized_timeout_default` 等明确来源，不伪装成人工批准。

### 8. 其他已发现但不作为本轮落地依据的官方能力

Claude 2.1.287+ 的 Mods 确有进程内插件 hooks、`$.clock.after(ms, callback)` / timer.cancel()、`turn.complete` 的 isAborted，以及 prompt.submit 事件；并非只能靠 shell hook。它们可作为后续免启动器备选，但还需核实输入时序、会话/窗口退出与恢复、插件 guard 和适用版本。官方文档还说明部分更完整的中断限制要求 2.1.304+；不据此宣称本机 2.1.293 已满足合同。[Mods 概览](https://code.claude.com/docs/en/plugins/mods/overview)、[定时及中断 API](https://code.claude.com/docs/en/plugins/mods/api)、[事件合同](https://code.claude.com/docs/en/plugins/mods/events)。本轮不继续扩展该方向。

Agent SDK 的公开 `onElicitation(request, {signal}) => Promise<ElicitationResult>` 及 TypeScript HookCallback 第三个参数 `{signal: AbortSignal}` 提供宿主控制；需自行提供输入界面与进程所有权，不能当成现有 Claude TUI 的项目配置字段。SDK 是另一种宿主接入，若选择需另评估 UX。[官方 TypeScript SDK](https://code.claude.com/docs/en/agent-sdk/typescript)、[官方 SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)。

### 9. 追加核查：普通 Bash 后台任务能否替代新启动器

本节响应新增建议，范围仅为主对话调用的普通 `Bash` 后台命令，不使用 Cron、远端 MCP task 或后台模型会话，也没有启动推理验证。

#### 9.1 已证实的接口、完成通知和退出语义

- 本机官方 `sdk-tools.d.ts:809` 定义 `BashInput`，参数是 `command: string`、`timeout?: number`、`description?: string`、`run_in_background?: boolean` 等；`:3297` 返回 `backgroundTaskId?: string`。因此应显式使用 `run_in_background:true`，不要把普通 shell 的 `&`、nohup、setsid 或让宿主超时误当成同一能力。
- 官方说明主对话发起的后台命令能跨该回合的最终回复继续运行，可在 `/tasks` 查看/停止；前台子代理拥有的后台命令则会随该子代理结束。计时应由主对话拥有的轻量等待进程承载，不能放进研究/实施子代理。[官方后台命令](https://code.claude.com/docs/en/tools-reference#background-commands)。
- 官方 `SDKTaskNotificationMessage` 明确包含 `run_in_background` Bash 的完成、失败、停止，状态为 completed / failed / stopped，携带 task_id、output_file、summary；文档还说明通知会送给模型，并有 `origin.kind === "task-notification"` 的回合来源，以及通知在空闲时到达的处理说明。**这支持“完成事件可进入空闲主会话并让模型处理”的候选，仍需验证本机普通 TUI 在无人输入时确实自动续接，以及到达顺序/延迟。** 不把仅收到一个 SDK 状态帧当成实测成功。[官方任务通知](https://code.claude.com/docs/en/agent-sdk/typescript#sdktasknotificationmessage)。
- 正常退出 Claude Code 会清理后台 Bash；macOS/Linux 的正常任务停止/退出清理还覆盖某些从 shell 脱离的进程。**后台化整个 Claude 会话则继续运行后台任务**，不能与退出混淆。[官方后台清理](https://code.claude.com/docs/en/interactive-mode#how-backgrounding-works)。
- 官方明确 `claude --resume` / `--continue` 不会重新启动上次的后台 Bash 命令和 Monitor。[官方恢复限制](https://code.claude.com/docs/en/scheduled-tasks#limitations)。但已有任务记录或补发的 stopped 通知并非旧工作再次启动：SDK 文档指出恢复会话可能用 task_notification 结束旧进程的任务记录。因此仍需判定通知状态和运行代号，不能把“收到旧任务通知”直接解释成到期授权。[官方运行标识与旧任务通知](https://code.claude.com/docs/en/agent-sdk/typescript#sdktaskstartedmessage)。
- Bash 的宿主 timeout 是命令资源上限，不是业务批准。本机类型注释写了后台默认/最大时长，而当前文档区分本地交互会话与无人值守会话；本地交互后台命令可没有这类上限，不得用该默认值证明业务计时精确。应由自己的等待程序计算秒数并正常退出。[官方后台时限](https://code.claude.com/docs/en/tools-reference#time-limit-for-background-commands)。

#### 9.2 可不新增启动器的最小组合建议

以下仍是推断方案，不是已实现能力：

1. 主对话先注册待决事项并启动一个 `run_in_background:true` 的等待程序；开始状态为“未计时”。完整展示方案、默认动作和安排后，**短 Stop hook 只负责确认展示并 arm**，随后立即返回、不阻塞用户输入；后台程序看到 arm 才开始计时。由此不把创建后台任务的时刻误当成展示完成。
2. 主会话回到原生输入界面。真实用户提交回复时，UserPromptSubmit 同步调用共享核心使旧事项失效，并通知等待程序退出；不需要代理先理解这段话才能取消。对取消后的 failed/stopped/completed 通知一律重新检查事项，不以任务退出码或“完成”字样批准。
3. 无人工输入而到期时，等待程序只输出事项 ID/到期事件，不实现业务动作、不调用 claude、不发消息、不持久化待恢复队列。原生任务完成通知交给仍打开的主会话处理。
4. 通知触发的续接必须再次进入核心仲裁，检查授权、计划摘要、运行代号和人工失效状态；只有在即将开始既有动作时消费决定。**后台计时结束不等于默认动作已开始**，这样截止后、动作前收到的人工回复仍能取消。使用单一仲裁者/锁处理此竞争。
5. SessionEnd 快速取消；新进程或手动 resume 创建新运行代号并使旧事项失效，compact 不应擅自换成另一次人工会话。强杀后即使等待程序变成孤儿，也只能输出旧事件，不能执行业务或重新唤醒模型；启动后的旧状态/通知必须拒绝消费。

项目 hooks 和共享核心可能足够实现此组合，无需 MCP、新前台启动器或修改 Claude 源码；平台启动器因此应保留为能力验证失败后的备选，不能预先判定必需。

#### 9.3 尚缺的证据与最小实验

| 关键点 | 目前判断 | 最小验证 |
| --- | --- | --- |
| 无人输入时自动续接 | 官方模型通知/通知回合提供支持，本机未测 | 原生 TUI 主对话启动短后台等待后结束；无人输入；观察原进程收到 completed 并自动执行无副作用标记 |
| 正常退出 | 官方明确清理后台命令，且 resume 不重启 | 退出发生在截止前；截止后确认无模型启动、无默认动作；手动 resume 拒绝旧事项 |
| SIGKILL/崩溃 | 主进程无法运行正常清理，子进程存活及补发记录未获完整保证 | 强杀主进程后等过截止，再手动 resume；检查孤儿只退出/输出，旧事件不被消费 |
| 人工回复优先 | 主会话空闲时 UserPromptSubmit 可作为同步失效门；截止附近时序未测 | 截止前、同时、通知已排队但动作未开始时分别提交拒绝/修改；旧动作均不得启动 |
| 输入与通知来源 | 不能假定 task_notification 一定经过或一定跳过 UserPromptSubmit；command hook schema 未给 SDK origin 字段 | 只记录隔离会话的事件来源与顺序，验证不会把内部通知当人工取消，也不会漏掉真实回复 |
| 单独 Esc/Ctrl+C | 缺少公开的通用 Claude Interrupt hook；不能推定会停止后台 Bash | 空闲等待时分别按 Esc/Ctrl+C，与显式提交“暂停”分开测试；若合同要求这些键立即撤销而平台不给事件，则仍有适配缺口 |
| 显示完成后计时 | 短 Stop + 摘要可组合，PTY 实际输出结束仍未测 | 保持长输出，验证等待从完整展示后开始，重复 Stop 不重复 arm |
| 后台化/脱离前台 | 文档明确整个会话后台化时任务继续 | 检查前台关闭/后台化的边界；如果产品要求前台离开即取消而无可靠事件，不能仅以 Bash 进程存活启用自动模式 |

**追加结论：** 用户提出的 background terminal 方向对 Claude 确有更直接的公开基础，可以优先于新增启动器实验；目前还不能声称它完整替代启动器。剩余核心是实际自动续接、人工取消仲裁和强杀后不消费旧事件，不是“能否运行一个 sleep”。

## Caveats / Not Found

- 没有真实验证人工选择、超时继续、正常退出、强杀取消；三者不能互相替代。
- 没有官方证据保证等待同步 Stop 时普通 Enter 会立即触发 UserPromptSubmit；候选必须不依赖该假设。
- 没有官方保证 SessionEnd 在 SIGKILL、崩溃、宿主或网络断开时必达；也没有证据允许仅用 session_id 判断用户窗口有效。
- 没有证据证明 SDK 请求到期发取消后，Claude TUI 一定关闭 elicitation 弹窗并立即恢复原工具；这是 MCP 路线最小阻塞实验。
- 当前在线文档包含比本机 2.1.293 更新的行为。特别是 Windows stdio 退出顺序、部分 Mods 中断控制和 MCP tasks，均已在文中注明版本边界。
- 普通后台 Bash 的完成通知、正常退出清理和 resume 不重启有官方依据；还没有验证人工取消竞争、空闲续接与强杀后旧通知处理。应优先实验该免新增入口候选，前台启动器保留为备选。
- 仅项目级 MCP/插件可注册扩展这一事实已经证实；“只改项目配置即可完整满足所有验收”仍未证实。前台启动器若最终需要，仍须用户决定是否接受新的入口，当前不得据此实施。
