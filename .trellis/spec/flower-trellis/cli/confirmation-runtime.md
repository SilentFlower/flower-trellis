# Confirmation Runtime

## Scenario: Native Background Confirmation

### 1. Scope / Trigger

- 修改项目 Python 确认入口、超时策略、状态机、宿主事件、窗口归属或确认 Hook 生命周期时适用。
- Brief、Check-All、Push 共用一套策略与单次领取。到期提醒只唤醒，业务仍由各自 owner 执行。
- Codex 保持普通启动和已有共享服务；Claude 使用原生后台任务通知。不增加启动包装、代理或 MCP。
- 自动路径支持可核验的 Linux/WSL 和原生 Windows。Linux/WSL Codex 使用 `/proc` 与 Python `os.pidfd_open`；
  Windows 核对本机控制连接、同用户的进程身份与退出句柄。任何必需能力缺失时保持人工。
  通用 CLI/脚本继续遵守 Node 18.17+、Python 3.8+ 基线；基线可加载不等于自动路径可用。

### 2. Signatures

```text
python3 -X utf8 .trellis/scripts/flower_confirmation.py prepare --platform codex|claude --input <项目内 JSON> [--seconds <1..86400>]
python3 -X utf8 .trellis/scripts/flower_confirmation.py wait --platform <平台> --session <UUID> --request <UUID>
python3 -X utf8 .trellis/scripts/flower_confirmation.py claim --platform <平台> --request <UUID>
python3 -X utf8 .trellis/scripts/flower_confirmation.py result --platform <平台> --request <UUID> --receipt <UUID> --state <执行状态>
python3 -X utf8 .trellis/scripts/flower_confirmation.py status|cancel --platform <平台> [--request <UUID>]
python3 .trellis/scripts/flower_confirmation_hook.py --entry
```

在 `status` / `cancel` 这一组中，`--request` 仅适用于 `cancel`。公共参数包括 `--session`、`--target`；
`result --state` 支持 `started|completed|interrupted|needs-verification`。
内部 `hook --platform <平台>` 从 stdin 接收原生 JSON。
`--entry` 是只读查询，成功返回 `{entry:[<准确 argv>]}`；缺失时返回 `{entry:null,reason:<原因>}` 并退出 1。
它与 Hook 转发共用 `[sys.executable, "-X", "utf8", <项目脚本绝对路径>]`；拒绝缺失入口和入口软链。
运行时只依赖 Python 标准库和项目脚本，Python 子调用复用当前解释器。旧 `flower-trellis confirm`
入口及 Node 确认实现已移除；Flower 安装器继续负责资产部署。

```text
flower_confirmation_runtime.store.ConfirmationStore(project, session_id, platform)
flower_confirmation_runtime.runtime.prepare(store, client, input_path, seconds=None)
flower_confirmation_runtime.runtime.wait(store, client, request_id, interrupted=lambda: False, notify=lambda value: None)
flower_confirmation_runtime.runtime.claim(store, client, request_id)
flower_confirmation_runtime.runtime.record_result(store, client, request_id, receipt, outcome)
flower_confirmation_runtime.codex.CodexClient(project, session_id, env=None, platform=None, timeout=5)
flower_confirmation_runtime.claude.ClaudeClient(project, session_id, platform=None)
flower_confirmation_runtime.session_log.SessionLog.read(file, initial, consume) -> (record, observation)
flower_confirmation_runtime.session_log.SessionLog.verify(frozen, current)
CodexClient.capture_window(turn_id) / verify_window(binding) / observe_window(binding)
flower_confirmation_runtime.transport.CodexTransport(path, timeout=5, notification=None, *, proxy=None, env=None)
flower_confirmation_runtime.windows_process.ProcessHandle(pid)
flower_confirmation_runtime.windows_process.open_identity(identity) -> ProcessHandle
src/lib/confirmation-lifecycle.js:
  cancelProjectConfirmations(project, reason = "project_disabled") -> number
  invalidateChangedConfirmations(project, plan, dryRun) -> void
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
- 输入 JSON 上限 1 MiB；需要解析的任务元数据、项目配置、Brief 源文档和待展示正文各限 512 KiB。
  仅用于指纹的普通文件分块哈希，读取前后核对文件身份和状态；其大小不受结构化材料上限约束。
  Windows 路径与打开句柄之间比较设备、文件身份、模式、大小和修改时间。Windows Python 3.12 的两种查询
  可能为同一文件返回不同的 `st_ctime_ns`，该字段只用于同一打开句柄读取前后的复核。Linux 保留完整比较。
- Check 提供完整 `body`、非空 `reportVersion` / `dispositionVersion`、全部 `findings`，每项为
  `{id: CHK-*|FBK-*|DOC-*, status: pending|accepted|resolved}`；同 ID 处置矛盾时拒绝。
- Push 提供完整 `body`、`mode: push|commit-only`、`evidence` 和 `repositories`。证据须满足
  `check: passed|accepted|focused`、`spec: no-op|written`、`unresolvedRisks: 0`。
  每仓包含精确 `root`、`branch`、`head`、`upstream`、`files`、`message`；无 upstream 的 push
  另给 `remote`、`remoteBranch`，就绪 merge 给 `mergeHead`。不从材料扩大原 owner 的权限或范围。
- 冻结任务材料、策略及 Git 分支、HEAD、索引、dirty、远端、文件内容、集成状态。Git 软链只读取链接值，
  不跟随到项目外。派发、领取、首次执行前都复核；改变输入或时长必须重新 prepare。
- Git 索引、两类 diff、状态及远端输出分块计算原有摘要，整仓输出不设固定字节上限。
  单条 Git 命令限 10 秒，Push 快照合计限 30 秒，外层策略进程限 40 秒。策略结构化输出最多 16 MiB。
  Git 超时或失败指出仓库与命令；预算理由参见容量任务的基线记录。
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
  原子替换与同步目录锁保护 generation；状态目录、文件不允许软链，正式文件最多 2 MiB。
  锁目录沿用 `<sessionId>.json.lock/owner.json` 的 `pid/token`，陈旧 owner 必须复核存活性后回收。
- Windows 创建锁目录短暂返回 `EPERM/EACCES` 时仅在原 1 秒预算内重试；持续拒绝保留原权限错误。
  只有成功取得锁后才能写 owner 和执行状态回调，不因权限错误偷锁或重放业务回调。
- Windows 竞争读取可能短暂占用 `owner.json` 或状态文件。原子 `replace` 和锁目录释放各使用
  1 秒单调时钟预算重试 `EPERM/EACCES`，仅重试文件操作。状态转换回调仍只执行一次。
  持续拒绝保留原权限错误；锁释放失败时，已经写入的状态事实继续保留。
- 正式 `request.contract.version=3`，包含平台、输入路径、时长覆盖、`frozenDigest`、原生记录观察点，以及
  Codex `windowBinding` 或 Claude `runId`。落盘只保存冻结快照摘要；领取返回复核得到的完整原有上下文。
  旧协议不能升级为正式许可；已经开始的动作继续支持终态记账。
- 主路径：`prepared -> waiting -> dispatching -> queued -> consumed`；终止态包括
  `cancelled`、`failed`、`delivery_unknown`。每次 prepare 替换旧请求，每个请求只允许一个 worker。
- 必须在活动回合 prepare，并最终完整展示返回的 `display`。worker 核对原回合完成和完整正文后才计时；
  实际倒计时使用单调时钟，持久 `deadline` 只用于展示。展示核验和排队后的领取各有独立的 300 秒期限。
- 展示匹配仅兼容围栏外 ATX 标题后的空行差异及 CRLF；正文、时长、动作、其它段落和围栏内容仍严格匹配，
  不改变冻结材料指纹，不把改写后的正文当作原材料。
- `claim` 只有返回 `claimed=true`、`source=policy_timeout` 和固定 `action` 才允许续接。
  action 仅为 `implement`、`repair_all_and_recheck`、`execute_git_plan`；返回冻结 `context` 和回执。
- 首个业务动作前，用回执 ID 记录 `started`，仅 `recorded=true` 可以执行。重复 started 不重跑；
  随后记录 `completed`、`interrupted` 或 `needs-verification`。存在 started 未终结时不能被新请求覆盖。
- 新人工输入先使旧代次失效；领取与 started 写锁内再次复核。回执丢失视为投递结果未知，不重发。
  取消后尽力撤回自己的队列项；迟到通知仍须领取，不能重放旧动作。
- `wait` 的常规轮询复用本轮已读状态。原生快照只包含已记录的人工消息或冻结基线时，不取写锁、不写状态；
  发现候选新消息时，在写锁内按最新请求和消息基线重新判断，再更新代次并作废旧许可。
- `wait` 收到 SIGINT/SIGTERM 先失效请求再退出 130。关闭项目先取消现有许可；卸载后的清理不能重建目录。

#### Native Hosts

- 两端 SessionStart 的 startup/clear/compact 和 resume state 均刷新不超过 512 字节的确认交接提示；
  resume 不重载完整工作流，禁用 Hook 时不输出。模型提示保持各自 2048 字节预算，不遮蔽确认准备分支。
- Codex 仅连接已有 `$CODEX_HOME/app-server-control/app-server-control.sock`，缺省 home 为 `~/.codex`。
  `CODEX_THREAD_ID`、Claude 的 `CLAUDE_CODE_SESSION_ID` 用于精确会话识别；显式会话不得与当前环境冲突。
- Codex 传输为标准库本机 Unix socket WebSocket/JSON-RPC：核验握手、掩码、分片及控制帧，
  单帧和聚合消息最多 16 MiB；连接及 RPC 默认超时 5 秒。写入回执未知时沿用单次投递边界。
  Windows 从当前原生输入 Hook 的活跃同用户进程取得 Codex 映像，使用该映像的本地 `app-server proxy --sock`
  连接同一已有控制服务。控制端点须位于本地目录；代理只收发字节并在关闭时回收自有进程。
- `mcpServerStatus/list` 使用准确 `threadId` / `serverName=codex_tui`，只接受 connected 的唯一 loopback
  HTTP origin。通过真实监听 socket 找前台进程，冻结 `version=1`、`origin`、`pid`、`startTicks`、
  `exe`、`uid`、`bootId`、`socketInodes`；pidfd 不序列化。窗口失效后不绑定新窗口来恢复旧请求。
- 用 `thread/loaded/list` 的会话来源与本机监听者核对覆盖；存在未对应会话的额外 Codex 前台时人工确认。
  同 thread 第二窗口不会接管原 MCP 服务，因此不能借第一窗口存活来证明第二窗口仍在。
  Windows 用精确 TCP 监听地址核对 PID，以同用户身份、映像和进程创建时间冻结原前台；原生进程句柄监测退出。
  同一发行的托管服务和前台可使用不同文件副本，须校验相同映像内容。
  已核验的前台映像出现额外进程时拒绝继续，覆盖第二窗口尚未建立监听的间隙。
- 观察连接不得调用 `thread/resume` 建立额外订阅。被动 `thread/read(includeTurns=false)` 提供准确 rollout
  路径；核对 session_meta、路径归属及完整 JSONL 行；不根据 cwd、进程名或最新文件猜会话。
- Codex 的 UserPromptSubmit / Interrupt Hook 作废人工输入代次；prepare 要求当前回合确实收到输入 Hook。
  唤醒使用原生 `thread/queue/add` / `thread/queue/delete`；消息正文与原生 UserMessage.client_id 都须匹配
  当前请求，人工粘贴相同文字不能冒充内部消息。
- Claude 使用 SessionStart / UserPromptSubmit / Stop / SessionEnd Hook。Stop 绑定精确后台 task ID 和完整
  最终正文；按 argv token 核对项目 Python `wait` 入口、会话与请求。完成后结束后台命令，由原生通知唤醒。
  Windows 从 Hook 祖先链核对同用户的 `claude.exe` 原前台。第二个存活前台使旧请求失效；句柄跟踪原进程退出。
  Windows 支持精确的 `py.exe -3.x` 和带引号的本地路径；命令范围、会话及请求照常核对。
  领取时核对 transcript 的 human / task-notification 来源及当前 runId，不能仅凭通知文字批准。
  Hook 先于该精确通知落盘时，claim 最多等待 1 秒补齐来源；期间持续核验人工输入与当前代次，
  到期仍缺来源则使旧许可失效。
  Windows 原生 transcript 可只有结构化 `origin.kind`。出现 `turnOrigin` 时必须与其一致。
  Linux/WSL 继续要求两个来源字段；任何平台都不从提醒正文推断真实通知。
- 两端按文件身份和已消费位置增量读取完整 JSONL 行，单条解析上限 16 MiB，文件总大小不限。
  原生最终展示核验上限 768 KiB。请求冻结记录文件身份和读取边界；替换、截断及边界漂移作废旧观察。
- 两端原生等待分别用 Codex 短 yield 的后台 terminal session、Claude Bash `run_in_background:true`。
  主回合展示后结束，不轮询、不用 clock.sleep 或等待子代理占住聊天。

#### Distribution

- 策略、共享协议和两端 owner 从 `vendor/skill-garden/.trellis/0.6/` 作者源维护，按
  compiled targets、enhancements 快照、本地 Plugin 投影顺序同步。
- Flower 的入口、`flower_confirmation_runtime/`、Hook、`flower_tui_lifetime.py` 与平台 Patch
  进入同一安装事务；策略继续来自 Skill-Garden。树投影和发布载荷排除 Python 缓存。
  更新保留 `confirmation_timeout`。
- 确认资产、策略或协议实际变化时，安装器在写入前通过随包 Python 的内部 `_cancel-project --target
  <项目> --reason project_updated` 使旧请求失效。预览和无变化更新保留原代次；空状态不启动子进程。
  项目关闭与卸载分别使用 `project_disabled`、`project_uninstalled`，已 started 的执行保留据实终结入口。
  卸载只清理自有命令引用，保留用户 Hook，不重建已经消失的平台目录。
- 先通过本地验证再请求精确 Git 计划确认；匹配提交的跨平台 CI 和快照干净门禁是后续交付门禁，
  不得用本机成功宣称所有平台通过。质量依据见 [Quality Guidelines](./quality-guidelines.md#testing)。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 无效平台、时长、材料、会话或项目配置 | 人工确认，不准备有效默认动作 |
| Windows 路径与句柄仅 `st_ctime_ns` 不同 | 正常读取；文件身份、内容状态或同一打开句柄的 `st_ctime_ns` 变化仍拒绝 |
| 单条 Git 命令或整轮快照超时 | 停止本次核验，返回命令或快照阶段；未完成的 Git 进程回收 |
| 会话文件超过历史总量，记录身份与完整行可核验 | 照常读取；只对新增完整行更新观察证据 |
| 会话文件替换、截断或已消费边界变化 | 拒绝使用冻结的旧证据 |
| `.flower/trellis-control.json` 存在，包括 null、损坏或漂移状态 | 保持人工确认 |
| 原生结构损坏或来源校验异常 | 使当前活动许可失效，返回结构化失败 |
| 未完整展示、原回合中断 | 不启动倒计时 |
| 常规轮询无新人工消息，写锁被占用 | 继续只读观察 |
| 新输入、改材料、改策略、改任务或 Git 快照 | 旧许可失效 |
| 前台退出、PID 复用、服务重绑或归属歧义 | 不派发或拒绝领取，不借用其他窗口 |
| Windows 额外的同映像 Codex 前台尚未监听，或 Claude 同会话出现第二个存活前台 | 旧等待失败或取消，保持人工 |
| Windows Claude 缺少结构化来源或两个来源字段冲突 | 不建立有效来源证据，不领取 |
| 重复 worker、提醒、claim、started | 至多单次领取和单次业务开始 |
| Windows 原子替换或锁释放短暂共享占用 | 有限重试文件操作，业务回调保持单次 |
| Windows 共享占用持续超过预算 | 保留原权限错误与已写入的状态事实 |
| 原生入队回执超时 | delivery_unknown，不重投 |
| 缺少 pidfd、原生来源或受支持环境 | 保留人工路径 |

### 5. Scenarios And Examples

- Normal：用 `{"kind":"brief","task":".trellis/tasks/example"}` 准备 Brief，后台启动 wait，完整展示 display
  并结束回合；到期领取一次，started 成功后由原 owner 开工。
- Base：Check 没有未处置项时不等待；总开关关闭或 Python 缺少 pidfd 时保持人工；查询空状态不创建目录。
- Incorrect use：恢复会话后重新找一个活窗口继续旧请求，或把相同提醒正文当成领取凭证。
  Correct handling：冻结原窗口身份，核对原生消息来源和当前代次；失效则停止旧动作，必要时重新准备。
- Normal：普通 Windows 窗口使用既有本机服务完成展示、倒计时与一次领取。启动第二窗口时，
  原窗口的有效监听不能作为第二窗口的归属证据。
- Normal：索引输出超过 4 MiB 或计划内普通文件超过 512 KiB 时按流式指纹核验；内容变化使旧许可失效。
- Incorrect use：测试依赖开发机真实 `~/.codex`。Correct handling：构造客户端时显式注入夹具创建的独立
  `env.CODEX_HOME`，测试结束清理自己的目录；不存在的宿主目录必须始终保持不存在。
- Normal：先用 `flower_confirmation_hook.py --entry` 获取精确 argv，再在该 argv 后追加 `prepare` 和
  材料参数。后续 `wait/claim/result` 继续使用同一入口，项目确认阶段可在隔离 Node/npm/Flower 的 PATH 运行。
- Incorrect use：Hook 已收到通知便把缺少 transcript 完整行视为有效来源。Correct handling：仅对当前精确
  通知等待有限落盘时间，获得真实来源后再原子领取；人工粘贴提醒仍使旧代次失效。

### 6. Tests Required

- `test_confirmation_store.py` / `test_project_confirmation.py`：完整展示起点、单调计时、重复领取、输入与派发/started 竞争、
  材料和 Git 快照漂移、结果未知、信号及卸载不复活状态目录。
  Windows 短暂拒绝创建锁后仅更新一次，持续拒绝时不执行回调；真实多进程竞争保留全部代次更新。
  原子替换与锁释放的短暂/持续共享占用分别断言回调次数、原错误、持久代次和锁生命周期。
  卸载竞争通过 queued 事件屏障固定目录删除与下一次观察的位置，保留真实线程退出及目录缺失断言。
  空轮询跨过活锁；锁释放后观察到的新人工消息仍取消旧请求。
- `test_confirmation_policy.py` 验证大 diff、大普通文件、旧摘要兼容、计划外状态漂移及 Git 超时回收。
  Windows 路径和句柄时间戳不同的回归覆盖结构化材料及流式指纹，分别断言接受时间戳差异、拒绝替换和拒绝读取中变化。
  `test_project_confirmation.py` 验证较大输入的状态仅存摘要、领取仍返回完整上下文、展示期限独立。
  `test_confirmation_native.py` 验证超过旧总量的日志、增量读取、不完整行及替换后旧证据失效。
- `test_confirmation_native.py` / `test_flower_tui_lifetime.py`：本机 WebSocket、帧边界、只读观察、真实内部来源、
  出生身份、归属歧义、恢复拒绝、能力不足；不存在宿主 Codex home 和隔离 PATH 下完成两端真实 Python CLI 链路。
- `test_confirmation_windows.py`：真实 Windows 监听者、同映像副本、PID 创建时间、退出句柄、第二个未监听前台；
  Claude 精确命令、双开作废、结构化来源缺失和冲突。实际 Windows Codex/Claude 窗口分别验证正常唤醒、退出和双开。
- `test_project_confirmation.py`：Claude 精确后台任务、原生通知与人工粘贴区分、输入取消、退出、runId 替换
  及 Hook 先于 transcript 完整行的有限等待；原生结构损坏也必须失效活动许可。
- `confirmation-install.test.js` / `test_confirmation_policy.py` / `test_flower_tui_lifetime.py`：默认与覆盖策略、关闭、重复更新、
  卸载、配置保留及缺能力分支；维持原生 Windows/Python 3.8/3.12 CI 覆盖。
  安装专项断言旧 CLI 清理、实际资产升级取消、dry-run/无变化代次保留，以及用户 Hook 保留。
- `test_flower_confirmation_hook.py` / `test_flower_session_start.py`：当前解释器与项目入口、缺失原因、事件转发原载荷，
  恢复时只刷新确认交接、全局关闭，以及提示和完整分段预算。
- `test_project_confirmation.py` 拒绝缺正文、改时间/动作、代码围栏或普通段落空行变化，仅接受标题后的空行差异。
  原生 owner 验收不得在用户提示中给出确认命令；Check 必须观察最终重检报告后再回收测试窗口。
- 原生实测分开记录：无模型窗口生命周期、Codex 真实队列唤醒、Claude 真实后台通知。隔离进程和协议替身
  不能代替真实模型验收；测试不得关闭用户窗口或停止共享服务。

## Scenario: Retired Confirmation Configuration Migration

### 1. Scope / Trigger

已安装 Flower 的项目执行 Skill-Garden 0.6 全量更新或重放时，清理可确认属于旧自动确认方案的项目配置及退役脚本。安装证据来自既有 Skill-Garden state 或有效的旧 Flower manifest。部分技能更新和冻结重放保留原有配置。

### 2. Signatures

- `flower-trellis update --target <项目> --skip-all --dry-run`：预演保留上游冲突文件时的 Flower 迁移。
- `flower-trellis update --target <项目> --skip-all`：应用同一迁移。上游冲突策略仍由 update 参数决定。
- `migrateLegacyConfirmationConfig({ value, original?, operation?, targetSpec, priorResults? })`：返回 `{ value, entries }` 或 `{ unchanged: true }`；不会直接写盘。

### 3. Contracts

- 配置白名单为 `.codex/config.toml`、项目根 `.mcp.json`、`.claude/settings.json` 和 `.claude/settings.local.json`。只检查普通文件和普通父目录。跨版本沙箱带入普通的项目根 `.mcp.json`，使预演和实际升级读取同类输入。
- 旧 MCP 同时核对实例名、Node 命令、`confirmation-mcp.js` 入口、旧会话变量及平台字段形态。Codex 仅移除与已移除服务器同值且无其它服务器引用的配套变量；Claude 仅移除同一计划已匹配项目注册的精确 `wait` 权限。
- Claude 旧插件与 directory marketplace 按历史标识和来源成对清理。旧 `ftl confirm hook` 按已知事件、matcher、命令、超时及工具条件精确识别。保留现行确认 Hook、`codex_tui`、`confirmation_timeout` 和自定义配置。
- 退役脚本仅检查 `.trellis/scripts/confirmation.py`。匹配历史分发内容或未修改的旧受管文件才删除。修改过的旧受管文件转为 shared，交还给用户维护。
- 配置清理与当前平台 Patch 合并到同一安装计划。跳过和无变化也产生目标结果，分别保持 `missing-target`、`not-applicable` 或 `unchanged` 语义；这些结果不产生迁移写入。预演只显示相对路径和命中的条目名，不输出旧会话值。真实写入与回滚沿用 Plugin 事务。

### 4. Validation & Error Matrix

| 条件 | 迁移结果 |
| --- | --- |
| 路径缺失或含软链，或目标非普通文件 | 跳过，迁移不创建文件 |
| JSON 重复键、数字无法无损序列化，或配置无法解析 | 保留原文 |
| TOML 删除后的完整语义与预期不一致 | 保留原文 |
| 写入时发现内容漂移或事务失败 | 沿用现有冲突和回滚机制 |

### 5. Scenarios and Examples

- 正常：同一计划识别 `.mcp.json` 中的旧 Claude MCP，并删除配置中与其配对的精确权限。
- 边界：重复升级时无旧条目，迁移无写入。现存的空配置仍保留文件。
- 错误做法：按前缀批量删除所有确认条目，或删除仍由当前实现调用的 `flower_confirmation_hook.py`。应核对历史签名，只清理证实退役的项。

### 6. Tests Required

- `test/js/confirmation-install.test.js`：真实跨版本预演零写入，保留用户配置、清理旧注册、替换旧入口；注入事务失败后恢复文件；重复执行无迁移变更；大整数、重复键及含其它引用的 TOML 反例保留。
- `test/js/platform-patches.test.js` / `test/js/patch-conflicts.test.js`：缺失平台目标的兼容语义和声明目标覆盖。原生 Ubuntu、Windows 按现有 CI 矩阵验证。
