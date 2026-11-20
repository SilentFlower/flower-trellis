# Codex 窗口归属与队列证据

## 现场与历史

- `vibecoding-bench` 的 `01a1f329-5cea-72f0-8586-c21f5323b8b2` 是 Codex `0.170.0` 内置窗口，进程 1175604。该会话的 `thread/read` 返回磁盘记录与 `notLoaded`，`mcpServerStatus/list` 返回 `thread not found`。原始复现为 `~/.codex/sessions/2026/11/19/rollout-2026-11-19T17-35-37-01a1f329-5cea-72f0-8586-c21f5323b8b2.jsonl:28241`。同会话较早记录在第 1365 行。使用 `eb41a07^` 的 `_origin` 现场只读重放得到同样错误。
- `d98888f` 首次引入共享服务 MCP 地址查询和全局额外窗口拒绝。`016cde7` 迁移到 Python，`eb41a07` 保持窗口查询路径。Codex 两版启动源码均将 `-c service_tier=…` 排除在隐式共享服务兼容配置之外。 [启动源码](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/tui/src/daemon_startup.rs#L89-L125)
- 当前共享会话的 `codex_tui` 正常返回，`_coverage()` 在上述内置窗口存在时回退人工，Linux 窗口扫描实际返回未归属窗口。后续要验证窗口归属变化的判定，当前探针没有改变运行环境。

## 内核身份与队列

- 截图会话的排他写锁通过设备和 inode 在 `/proc/locks` 对应 1175604，该 PID 也持有本机 TUI 监听。现有 `bind_origin` 与 `open_binding` 对同一 PID 成功返回可观察的 `pidfd`。当前共享会话的排他写锁由 1711873 持有，这也是 Unix 控制连接 `SO_PEERCRED` 返回的 PID。只读对端检查显示内置进程的 Unix socket 位于自身进程内，当前共享 TUI 的 Unix socket 与共享服务连接匹配。 [Codex 写锁源码](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/rollout/src/writer_lock.rs#L36-L98)
- 通过 Python 标准库直接读取 `NETLINK_SOCK_DIAG` 的 `UNIX_DIAG_PEER`，并按双方 fd inode 核对。当前共享前台有一对与共享服务匹配的 Unix socket，截图内置前台没有。这验证了现场可用的内核观测能力，实施仍须覆盖权限、快照中断和其他传输形态。
- 在独立临时用户目录和本机模型替身中，真实 `0.171.0` 内置 TUI 完成首回合。另一个同用户目录的 App Server 读到该线程 `notLoaded`，成功通过原生 `thread/queue/add` 入队。约 9.56 秒后内置 TUI 完成新回合，原生日志保留相同 `client_id`。该探针覆盖投递及唤醒原语。完整 Trellis 领取、进程退出、精确撤回及混合版本列为实施验收。
- `0.170.0` 和 `0.171.0` 源码均在 `ext/queue/src/service.rs` 实现十秒检查其他进程的队列写入。 [0.170.0](https://github.com/openai/codex/blob/rust-v0.170.0/codex-rs/ext/queue/src/service.rs#L90-L117) · [0.171.0](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/ext/queue/src/service.rs#L90-L117)
- 官方 App Server 协议的 `thread/loaded/list` 只有线程 ID。`mcpServerStatus/list` 查询对应线程的 MCP 连接。UserPromptSubmit 提供会话和回合身份；共享模式的 Hook 进程可以由 daemon 派生。单靠这些信息无法区分同会话的两个前台。 [Codex App Server](https://learn.chatgpt.com/docs/app-server#api-overview) · [前台归属问题](https://github.com/openai/codex/issues/58431)

## 项目规格

- [.trellis/spec/flower-trellis/cli/confirmation-runtime.md](../../../spec/flower-trellis/cli/confirmation-runtime.md) 的 Native Hosts 与 State And Single Execution。
- [.trellis/spec/flower-trellis/cli/quality-guidelines.md](../../../spec/flower-trellis/cli/quality-guidelines.md) 的 Python 跨平台验证和标准库约束。

## 实施验收

- 在独立 Linux 用户与临时 `CODEX_HOME` 中并行启动真实 `0.170.0` 内置 TUI、`0.171.0` 共享 App Server 和共享 TUI。模型输出使用本机替身，初始 Hook 状态取自各自的真实活动回合，队列、终端、日志和窗口生命周期均由原版 Codex 处理。
- 两窗口各自完成完整展示后计时、队列唤醒、一次 `claim` 与 `started/completed`。已消费的重复领取被拒绝。连接共享服务的第二个同会话前台被识别并拒绝。
- 在另一内置窗口冻结队列消费者，等到精确提醒已入队后关闭其进程。worker 观测退出并撤回该队列 ID，旧领取返回 `cancelled`。恢复同一会话后新请求绑定新的 TUI PID，旧请求返回 `not_current`。
- 在内置 TUI 的实际输入框发送新消息。原生日志出现该输入，worker 在投递前记录 `cancelled/user_replied`，原队列没有旧提醒。
- Python 内核专项覆盖真实独占写锁、实际 Unix socket 对端、第二前台尚未监听，以及同样持有写锁和本机监听的普通 App Server 终端被拒绝。线上现场核对只调用窗口定位与复核。
