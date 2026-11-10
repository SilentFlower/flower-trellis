# Confirmation Runtime

## Scenario: Native Background Confirmation

### 1. Scope / Trigger

- 修改 `confirm` CLI、超时策略、状态机、宿主事件、窗口归属或确认 Hook 生命周期时适用。
- Brief、Check-All、Push 共用一套策略与单次领取。到期提醒只唤醒，业务仍由各自 owner 执行。
- Codex 保持普通启动和已有共享服务；Claude 使用原生后台任务通知。不增加启动包装、代理或 MCP。
- 自动路径限于可核验的 Linux/WSL。Codex 必须具备 `/proc` 与 Python `os.pidfd_open`；能力不足保持人工。
  通用 CLI/脚本继续遵守 Node 18.17+、Python 3.8+ 基线；基线可加载不等于自动路径可用。

### 2. Signatures

```text
flower-trellis confirm prepare --platform codex|claude --input <项目内 JSON> [--seconds <1..86400>]
flower-trellis confirm wait --platform <平台> --session <UUID> --request <UUID>
flower-trellis confirm claim --platform <平台> --request <UUID>
flower-trellis confirm result --platform <平台> --request <UUID> --receipt <UUID> --state <执行状态>
flower-trellis confirm status|cancel --platform <平台> [--request <UUID>]
python3 .trellis/scripts/flower_confirmation_hook.py --entry
```

在 `status` / `cancel` 这一组中，`--request` 仅适用于 `cancel`。公共参数包括 `--session`、`--target`；
源码项目使用 `node bin/flower-trellis.js` 入口。`hook --platform <平台>` 从 stdin 接收原生 JSON。
`--entry` 是只读查询，成功返回 `{entry:[<准确 argv>]}`；缺失时返回 `{entry:null,reason:<原因>}` 并退出 1。
它与 Hook 转发共用解析：`package.json.name=flower-trellis` 且存在本仓 bin 时优先本仓 Node 入口，
其它项目使用已安装 Flower；不以文件探测命令的空 stdout 推断缺失，也不要求升级全局安装。

```text
ConfirmationStore(project, sessionId, { platform })
prepareFormalConfirmation({ store, client, input, platform, seconds })
waitFormalConfirmation({ store, client, platform, requestId, signal, notify })
claimFormalConfirmation({ store, client, platform, requestId })
recordConfirmationResult({ store, client, platform, requestId, receipt, state })
captureCodexTui({ client, sessionId, project, inspect? })
verifyCodexTui({ client, sessionId, project, binding, inspect? })
verifyCodexTuiCoverage({ client, project, inspect? })
watchCodexTui(binding, { project }) -> { ready, close, exited/invalid 事件 }
```

### 3. Contracts

#### Materials And Policy

- 最终 Brief、正式 Check-All 报告与精确 Push 计划收敛后，owner 必须在最终回复前决定模式并尝试合资格
  prepare/wait/display；排除或实际失败才人工，并给出具体原因。已有有效授权和 auto-loop 不叠加等待。
  准备不要求事先领取回执，业务仍须领取并 started。泛化的只读 inspect 不保证进入正式 Check-All。
- Check-All 先单独完整读取 reporting，Push 的 Git 写入与确认模式门禁放在入口首部；上游交接和模板
  不再另设人工必答门槛。Check 修复结束必须重检，不能以定向测试代替，重检结束后才记 completed。
- 输入为项目内有界普通 JSON 文件，公共字段为 `kind: brief|check|push`、精确当前 `task`，无任务用 null。
  材料路径不得越界或经过软链接；Brief 正文来自当前任务 `brief.md`。
- Check 提供完整 `body`、非空 `reportVersion` / `dispositionVersion`、全部 `findings`，每项为
  `{id: CHK-*|FBK-*|DOC-*, status: pending|accepted|resolved}`；同 ID 处置矛盾时拒绝。
- Push 提供完整 `body`、`mode: push|commit-only`、`evidence` 和 `repositories`。证据须满足
  `check: passed|accepted|focused`、`spec: no-op|written`、`unresolvedRisks: 0`。
  每仓包含精确 `root`、`branch`、`head`、`upstream`、`files`、`message`；无 upstream 的 push
  另给 `remote`、`remoteBranch`，就绪 merge 给 `mergeHead`。不从材料扩大原 owner 的权限或范围。
- 冻结任务材料、策略及 Git 分支、HEAD、索引、dirty、远端、文件内容、集成状态。Git 软链只读取链接值，
  不跟随到项目外。派发、领取、首次执行前都复核；改变输入或时长必须重新 prepare。
- `.trellis/config.yaml` 的 `confirmation_timeout` 默认开启，支持总 `enabled` 和三种类型的 `enabled`。
  Brief 默认 1000 个规范化 Unicode 字符内 100 秒，每超 500 字符加 30 秒，按档向上取整；
  Check 一项 100 秒，每多一个唯一 pending CHK/FBK 加 30 秒，零项不等待；Push 默认 200 秒。
  单次 `--seconds` 优先，但不能绕过关闭开关；坏配置、重复字段、非整数或超界保持人工。
  可覆盖的计算字段为 `brief.base_seconds/threshold_chars/increment_chars/increment_seconds`、
  `check.base_seconds/increment_seconds`、`push.seconds`。
- 产品决策、未接受风险、宿主审批、auto-loop 不由计时器补充授权。本机制自身开发任务设置
  `task.json.meta.confirmationTimeoutDisabled=true`，始终人工确认。

#### State And Single Execution

- 正式状态为 version 2，位于 `.trellis/.runtime/confirmation-<platform>/<sessionId>.json`。
  原子替换与同步目录锁保护 generation；状态目录、文件不允许软链，正式文件最多 1 MiB。
- Windows 创建锁目录短暂返回 `EPERM/EACCES` 时仅在原 1 秒预算内重试；持续拒绝保留原权限错误。
  只有成功取得锁后才能写 owner 和执行状态回调，不因权限错误偷锁或重放业务回调。
- 正式 `request.contract.version=2`，包含平台、输入路径、时长覆盖、冻结快照，以及 Codex
  `windowBinding` 或 Claude `runId`。旧协议不能升级为正式许可。
- 主路径：`prepared -> waiting -> dispatching -> queued -> consumed`；终止态包括
  `cancelled`、`failed`、`delivery_unknown`。每次 prepare 替换旧请求，每个请求只允许一个 worker。
- 必须在活动回合 prepare，并最终完整展示返回的 `display`。worker 核对原回合完成和完整正文后才计时；
  实际倒计时使用单调时钟，持久 `deadline` 只用于展示。展示核验与排队后的领取各有五分钟预算。
- 展示匹配仅兼容围栏外 ATX 标题后的空行差异及 CRLF；正文、时长、动作、其它段落和围栏内容仍严格匹配，
  不改变冻结材料指纹，不把改写后的正文当作原材料。
- `claim` 只有返回 `claimed=true`、`source=policy_timeout` 和固定 `action` 才允许续接。
  action 仅为 `implement`、`repair_all_and_recheck`、`execute_git_plan`；返回冻结 `context` 和回执。
- 首个业务动作前，用回执 ID 记录 `started`，仅 `recorded=true` 可以执行。重复 started 不重跑；
  随后记录 `completed`、`interrupted` 或 `needs-verification`。存在 started 未终结时不能被新请求覆盖。
- 新人工输入先使旧代次失效；领取与 started 写锁内再次复核。回执丢失视为投递结果未知，不重发。
  取消后尽力撤回自己的队列项；迟到通知仍须领取，不能重放旧动作。
- `wait` 收到 SIGINT/SIGTERM 先失效请求再退出 130。关闭项目先取消现有许可；卸载后的清理不能重建目录。

#### Native Hosts

- 两端 SessionStart 的 startup/clear/compact 和 resume state 均刷新不超过 512 字节的确认交接提示；
  resume 不重载完整工作流，禁用 Hook 时不输出。模型提示保持各自 2048 字节预算，不遮蔽确认准备分支。
- Codex 仅连接已有 `$CODEX_HOME/app-server-control/app-server-control.sock`，缺省 home 为 `~/.codex`。
  `CODEX_THREAD_ID`、Claude 的 `CLAUDE_CODE_SESSION_ID` 用于精确会话识别；显式会话不得与当前环境冲突。
- `mcpServerStatus/list` 使用准确 `threadId` / `serverName=codex_tui`，只接受 connected 的唯一 loopback
  HTTP origin。通过真实监听 socket 找前台进程，冻结 `version=1`、`origin`、`pid`、`startTicks`、
  `exe`、`uid`、`bootId`、`socketInodes`；pidfd 不序列化。窗口失效后不绑定新窗口来恢复旧请求。
- 用 `thread/loaded/list` 的会话来源与本机监听者核对覆盖；存在未对应会话的额外 Codex 前台时人工确认。
  同 thread 第二窗口不会接管原 MCP 服务，因此不能借第一窗口存活来证明第二窗口仍在。
- 观察连接不得调用 `thread/resume` 建立额外订阅。被动 `thread/read(includeTurns=false)` 提供准确 rollout
  路径；核对 session_meta、路径归属及完整 JSONL 行，按文件身份缓存并增量读取。上限为文件 128 MiB、
  单条记录 2 MiB；不根据 cwd、进程名或最新文件猜会话。
- Codex 的 UserPromptSubmit / Interrupt Hook 作废人工输入代次；prepare 要求当前回合确实收到输入 Hook。
  唤醒使用原生 `thread/queue/add` / `thread/queue/delete`；消息正文与原生 UserMessage.client_id 都须匹配
  当前请求，人工粘贴相同文字不能冒充内部消息。
- Claude 使用 SessionStart / UserPromptSubmit / Stop / SessionEnd Hook。Stop 绑定精确后台 task ID 和完整
  最终正文；完成后结束后台命令，由原生通知唤醒。领取时核对 transcript 的 human / task-notification 来源
  及当前 runId，不能仅凭通知文字批准。
- 两端原生等待分别用 Codex 短 yield 的后台 terminal session、Claude Bash `run_in_background:true`。
  主回合展示后结束，不轮询、不用 clock.sleep 或等待子代理占住聊天。

#### Distribution

- 策略、共享协议和两端 owner 从 `vendor/skill-garden/.trellis/0.6/` 作者源维护，按
  compiled targets、enhancements 快照、本地 Plugin 投影顺序同步。
- Flower 的 Hook 资产与平台 Patch 进入同一安装事务；更新保留 `confirmation_timeout`。
  卸载只清理自有命令引用，保留用户 Hook，不重建已经消失的平台目录。
- 先通过本地验证再请求精确 Git 计划确认；匹配提交的跨平台 CI 和快照干净门禁是后续交付门禁，
  不得用本机成功宣称所有平台通过。质量依据见 [Quality Guidelines](./quality-guidelines.md#testing)。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 无效平台、时长、材料、会话或项目配置 | 人工确认，不准备有效默认动作 |
| 未完整展示、原回合中断 | 不启动倒计时 |
| 新输入、改材料、改策略、改任务或 Git 快照 | 旧许可失效 |
| 前台退出、PID 复用、服务重绑或归属歧义 | 不派发或拒绝领取，不借用其他窗口 |
| 重复 worker、提醒、claim、started | 至多单次领取和单次业务开始 |
| 原生入队回执超时 | delivery_unknown，不重投 |
| 缺少 pidfd、原生来源或受支持环境 | 保留人工路径 |

### 5. Scenarios And Examples

- Normal：用 `{"kind":"brief","task":".trellis/tasks/example"}` 准备 Brief，后台启动 wait，完整展示 display
  并结束回合；到期领取一次，started 成功后由原 owner 开工。
- Base：Check 没有未处置项时不等待；总开关关闭或 Python 缺少 pidfd 时保持人工；查询空状态不创建目录。
- Incorrect use：恢复会话后重新找一个活窗口继续旧请求，或把相同提醒正文当成领取凭证。
  Correct handling：冻结原窗口身份，核对原生消息来源和当前代次；失效则停止旧动作，必要时重新准备。
- Incorrect use：测试依赖开发机真实 `~/.codex`。Correct handling：构造客户端时显式注入夹具创建的独立
  `env.CODEX_HOME`，测试结束清理自己的目录；不存在的宿主目录必须始终保持不存在。

### 6. Tests Required

- `confirmation-store` / `confirmation-runtime`：完整展示起点、单调计时、重复领取、输入与派发/started 竞争、
  材料和 Git 快照漂移、结果未知、信号及卸载不复活状态目录。
  Windows 短暂拒绝创建锁后仅更新一次，持续拒绝时不执行回调；真实多进程竞争保留全部代次更新。
- `codex-queue-client` / `codex-confirmation-client` / `codex-tui-lifetime`：只读观察、真实内部来源、出生身份、
  归属歧义、恢复拒绝、能力不足；在不存在宿主 Codex home 的环境实际运行，不能依赖本机配置。
- `claude-confirmation-client`：精确后台任务、原生通知与人工粘贴区分、输入取消、退出及 runId 替换。
- `confirmation-install` / `test_confirmation_policy` / `test_flower_tui_lifetime`：默认与覆盖策略、关闭、重复更新、
  卸载、配置保留及缺能力分支；维持原生 Windows/Python 3.8/3.12 CI 覆盖。
- `test_flower_confirmation_hook` / `test_flower_session_start`：入口源码优先、安装与缺失原因、事件转发原载荷，
  恢复时只刷新确认交接、全局关闭，以及提示和完整分段预算。
- `confirmation-runtime` 拒绝缺正文、改时间/动作、代码围栏或普通段落空行变化，仅接受标题后的空行差异。
  原生 owner 验收不得在用户提示中给出 confirm 命令；Check 必须观察最终重检报告后再回收测试窗口。
- 原生实测分开记录：无模型窗口生命周期、Codex 真实队列唤醒、Claude 真实后台通知。隔离进程和协议替身
  不能代替真实模型验收；测试不得关闭用户窗口或停止共享服务。
