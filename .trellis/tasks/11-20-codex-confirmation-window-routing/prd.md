# 修复 Codex 内置窗口定位与混用后台确认

## Goal

让 Linux/WSL 下的 Codex 内置窗口和共享窗口在能够核验各自会话归属时正常使用 Trellis 后台确认。

## Background

- `vibecoding-bench` 的 Codex `0.170.0` 因启动参数 `-c service_tier=…` 使用内置服务。共享服务对该会话返回 `notLoaded`，后续 `mcpServerStatus/list` 返回 `thread not found`。现场日志和证据见 [窗口归属研究](research/window-evidence.md)。
- 同时打开上述内置窗口和另一个正常共享会话时，共享会话可取得 `codex_tui` 地址，但 Linux 全局窗口扫描将内置窗口误判为可能的同会话双开。对应入口是 `src/assets/flower_confirmation_runtime/codex.py` 的 `_origin`、`_coverage` 与 `src/assets/flower_tui_lifetime.py` 的 `check_frontend_coverage`。
- 用户确认同时修复内置窗口定位及无关内置窗口对共享窗口的影响。当前交付范围为 Linux/WSL 本机、同一 Codex 用户目录下已有本机共享服务的现场拓扑。

## Requirements

- R1：当当前 Codex 回合由内置服务运行时，Trellis 能核验同一会话的实际前台并使用已有原生队列唤醒该会话。沿用正常 `codex`、`codex resume` 与现有启动参数。
- R2：额外窗口经核实属于其他独立会话时，对当前共享窗口的确认无影响。同一会话双开、归属不明或原窗口变化时拒绝自动执行，并报告明确阶段和原因。
- R3：保持三个工作流入口的完整展示后计时、当前输入序号、精确原生唤醒、材料和 Git 范围、单次领取与 `started` 复核。原窗口退出或新输入先到时，使旧请求失效。尚在队列中的旧提醒按其原生 ID 撤回；已送达的迟到提醒无法取得有效许可。
- R4：宿主能力或原身份在准备、等待和执行前发生变化时回到既有的人工作业流程。升级后新请求按有效窗口重新准备，已开始的旧请求按原契约记账。

## Acceptance Criteria

- [ ] AC1（R1、R3）：隔离真实 Codex 的内置会话完整展示后计时，经另一 App Server 投递请求并唤醒原会话，最终精确领取及 `started` 各一次。验证目标包含截图的 `0.170.0` 内置端与 `0.171.0` 共享端组合。
- [ ] AC2（R2）：不同会话的内置窗口和共享窗口同时存在时，共享窗口能完成倒计时及领取。同一共享会话再打开前台以及未知归属窗口仍走人工，包含第二窗口正在连接的时序。
- [ ] AC3（R3、R4）：新输入、关原窗口、原进程替换、会话恢复和重复唤醒均覆盖。待消费旧提醒按精确 ID 撤回，迟到提醒和恢复的新窗口均无法执行旧默认动作。
- [ ] AC4（R2—R4）：覆盖读取权限缺失、PID 复用、锁或 socket 归属漂移、共享服务断开及投递回执未知。验证 Brief、Check-All 和 Push 的共同入口、安装升级后的状态兼容及 Linux/WSL、原生 Windows、Claude 既有回归。

## Scope Boundaries

- 新增路径限 Linux/WSL 本机混用拓扑；缺少共享队列接入或内核身份观测能力的窗口保留人工确认。
- Claude 与原生 Windows 沿用各自现有的窗口识别方式和支持范围。升级实际业务项目、软件发版及部署由独立流程承接。
- 本任务开发后台确认机制自身，按项目协议采用人工阶段确认。自动链路验收使用隔离环境。
