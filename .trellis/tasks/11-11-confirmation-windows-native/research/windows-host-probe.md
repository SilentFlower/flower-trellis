# Windows 原生宿主探针

- Windows NT 10.0.26200；Windows Python 3.8.10、3.12.2；Codex CLI 0.164.0、Claude Code 2.1.260。
- Codex CLI 的 `app-server proxy` 支持精确的本地 `--sock`。原生 Python 3.12 未暴露 `socket.AF_UNIX`；临时目录使用只授予当前 Windows 用户的 ACL 后，隔离的 Codex app-server 建立了 Unix 控制 socket。代理对现有 WebSocket 握手返回 `HTTP/1.1 101 Switching Protocols`，退出码为 0。
- 当时真实用户目录的 `app-server daemon version` 返回连接拒绝。隔离成功只证明 Windows 上的连接方式可行，普通原生 TUI 何时启动共享服务、窗口监听归属及队列唤醒仍需实测。
- Windows 的候选进程归属接口：[GetExtendedTcpTable](https://learn.microsoft.com/en-us/windows/desktop/api/iphlpapi/nf-iphlpapi-getextendedtcptable) 提供本机监听者 PID；[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes) 提供进程创建时间。是否能安全区分普通窗口和同会话双开，以实际宿主测试为准。
- Claude 的现有 Hook 转发和客户端显式限定 Linux；现有 Stop 参数识别采用 POSIX 分词。Windows 的 Hook 载荷、后台命令、通知来源和退出尚待实机观察。

## 实施后的宿主证据

- 本轮在隔离项目以原生 Windows ConPTY 启动正常 Codex / Claude 窗口，模型响应由本机测试服务提供。实际宿主负责 Hook、展示、队列或后台任务通知、会话记录及退出。测试 action 为隔离的 Check 记录，领取后仅记录测试状态。
- Codex 0.164.0：普通窗口启用托管服务。Windows 上普通文件查询可能看不到托管控制端点；实际代理能完成 WebSocket、initialize、`thread/loaded/list` 与线程快照。原生 Hook 的进程是托管服务，监听者是安装版前台。两者为同一发行映像的不同文件副本，因此核验文件身份或相同内容，并以监听者 PID 和创建时间冻结前台。
- Codex 正常链路：实际 `prepared -> waiting -> queued -> consumed`，重复领取返回 `consumed`，started 和 completed 均记录成功。原窗口退出用例在等待中仅关闭隔离测试的原前台；worker 返回 `frontend_exited`，状态为 cancelled。
- Claude Code 2.1.260：正常窗口实测 SessionStart / UserPromptSubmit / Stop / SessionEnd 的 Hook 祖先对应同一原生进程。Stop 提供 `type=shell` 和精确后台任务；会话记录提供结构化 `origin.kind=human` 或 `task-notification`，该版本可没有 `turnOrigin`。无结构化来源或两个来源字段冲突时保持人工。
- Claude 正常链路：真实 Bash 后台任务完成后触发原生通知，`claimed`、`started`、`completed` 均为真；原窗口正常退出用例最终为 `cancelled/session_ended`。同会话二次打开使原请求为 `cancelled/frontend_ambiguous`，后续领取返回人工原因。
- Windows Python 3.8 在高并发本地验证曾暴露已有的 1 秒锁忙窗口；锁协议保持原预算。多进程压力测试仅对回调执行前的确定锁忙做限时重试，仍检查 48 次增量全部保留，失败时回收所有本测试子进程。
- Codex 双开复测：普通原窗口已在 waiting 时启动同会话的第二前台。第二个进程尚未建立监听时也被已验证前台映像的进程枚举覆盖；worker 返回“存在未归属的 Windows Codex 前台，保持人工确认”，状态为 failed。补强后另一次正常窗口仍完成全链路及单次领取。

## 回归结果

- 原生 Windows Python 3.8.10 和 3.12.2 确认专项各 57 项，48 通过、9 项 Linux 专属用例跳过。最终 Windows 进程及状态锁定向复查在两个版本各 11 项通过；3.8 的确认专项在修正压力测试后重跑通过。
- WSL/Linux 的全量 `npm test` 中 JavaScript 690 项通过，Python 599 项通过。最后一轮 Windows 专属分支和测试变化使用定向回归补核。
