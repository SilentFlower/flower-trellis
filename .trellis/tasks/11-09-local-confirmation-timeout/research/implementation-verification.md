# 后台确认演练实施证据

## 环境与复现

- Linux/WSL 工作区，Node v22.23.4，Codex CLI / managed daemon 0.167.0。
- 生产入口：`node scripts/codex-confirmation.mjs --help`。
- 定向测试：`node --test test/js/codex-confirmation.test.js test/js/codex-queue-client.test.js`。
- 原生工具链：`node .trellis/tasks/11-09-local-confirmation-timeout/research/native-background-probe.mjs`。
- 原生结果：`native-background-result.json`，探针使用独立临时项目和 CODEX_HOME，复制当前生产入口与两个内部模块，依赖指向当前项目已安装的 node_modules。

## 已观察到的真实行为

- 模型响应由本地 HTTP SSE 替身提供，没有外部模型调用。本地替身使用 gpt-5.4 作为测试模型标识，客户端实际提供了 exec_command 工具；不据此评价模型是否能自主理解说明。
- 原生 exec_command 两次各在约 1 秒返回后台 session；结果包含 prepared，请求此时 deadline=null。
- 替身发送 final 结束主回合后才进入 waiting。1 秒、2 秒各自到期，经真实原生队列启动同一线程的新回合。
- 唤醒回合用真实 exec_command 调用生产 claim，分别只领取一次 NATIVE_DONE_1 / NATIVE_DONE_2。
- 第二个请求重复入队相同内部唤醒，再次调用生产 claim 返回 claimed=false / consumed，没有第二份演练文本。
- 另一次 2 秒等待期间，真实 turn/start 提交新人工消息成为正常新回合；worker 状态转 cancelled。越过旧截止时间后没有该请求的领取。
- 到期唤醒回合已开始、模型响应被测试替身暂缓时提交真实 turn/steer：此时用户 item 尚未广播；释放模型响应后，Codex 在后续命令执行前落实追加输入，worker 转 cancelled，没有旧文本的有效领取。这是实际观测，不推定输入草稿或尚未广播的 steer 已经立即可见。
- 两个真实连接 worker 竞争同一请求，仅一个有效 worker；daemon 接收后由测试包装器故意丢弃回执，最终 delivery_unknown，迟到 claim 被拒绝且只发送一次。这里明确是故障注入，不声称自然网络丢包。
- 终止生产观察端的真实 socket，waiting 请求转 failed，没有投递队列。
- daemon stop 后按临时根目录、PID 与 /proc 出生标识清理本探针的 pid-update-loop，不修改或停止用户真实 daemon。

## 定向测试范围

19 项测试涵盖时间和文本校验、准备中不计时、重复 worker、多个领取竞争、人工消息重复通知、投递中及投递后取消、领取端重新核对基线、同会话替换和跨会话隔离、回执未知、断连/中断、精确撤回失败、损坏状态、多进程锁、无副作用帮助、协议参数及快照分页。

## 尚待单独验收的边界

- `go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/ci.yml` 已通过（实际解析 v1.7.12），CI YAML 解析确认 Ubuntu/Windows 两平台均包含两份专项。
- 用户实际新会话的体验验收已完成，依据同一会话的真实消息、原生命令输出与当前状态复核，详见下方记录；没有用本地模型替身替代实际体验。
- Ubuntu/Windows CI 已加入两份专项；原生 Unix socket 连接测试在 Windows 明确 skip，其余状态、并发、入口和不支持诊断照常执行。业务提交已推送，匹配 headSha 的远端 CI 已通过，具体 run 与矩阵结果见下方记录。
- 已开始的模型回合无法撤销；单次有效领取不等于端到端 exactly-once 文本展示。领取后的进程或模型失败不自动重放，避免重复默认动作。
- 本地记录与原生队列不共享事务。人工消息取消与领取按本地锁内生效顺序裁决；领取后到达的取消不能撤销已返回正文。输入框未提交草稿不可见。
- 窗口关闭不保证取消；断连失败或未知回执不会被视为同意；没有自动接入 Brief / Check / Push。

## 完整回归进度

- 首次完整运行：新增多进程压力用例未允许短锁预算返回繁忙而失败。测试改为仅对明确的锁繁忙做有界重试，不调整产品锁预算或放宽状态断言。
- 第二次完整运行：JS 703 项，701 通过、2 项原有条件 skip；Python 546 项，544 通过、2 项原有条件 skip；Patch 冲突、compiled targets、上下文预算和输出模板检查均通过，同一 npm test 最终退出码为 0。上下文预算存在非阻断 warning，未修改阈值。

- 使用生产客户端对当前真实会话做只读核对：session / project 均匹配、模型 gpt-6.1-sol、存在人工消息基线；没有向当前用户会话投递测试唤醒。CI 影响分类为 full/contracts/python/update 全 true。

- 最终进程核对：本次原生探针临时根目录下没有存活进程；测试没有遗留自有 daemon 或 worker。

## 用户实际会话验收

- 会话：`01a1be0c-546d-7ce0-95de-6367d3bebc69`（当前项目，用户正常打开的 Codex）。主会话只读取记录和队列，没有向该会话发送测试消息或代用户操作。
- 到期续接：用户发起 15 秒等待，请求 `e0a8ca28-8031-4144-8df8-e5e2e230fb65`。主回合结束后开始计时；到期唤醒，真实 claim 返回 claimed=true，最终仅输出“演练完成”。
- 中途取消：用户发起 60 秒等待，请求 `f22287b9-101f-4e26-84b5-f35214d5be68`，随后要求只回复“收到修改”，且明确不调用 cancel、不重建计时。原生命令输出确认 state=cancelled、error=user_replied、queueId=null；窗口仅回复“收到修改”，原截止时间后没有旧默认文本。
- 改时重建：原 60 秒请求 `bcb0678d-1300-49b8-8ac6-1493a35ab54c` 因用户修改消息取消并退出，queueId=null。新 10 秒请求 `76cb4990-6a48-4587-b172-c110004170f3` 从新回合结束后重新计时，真实 claim 成功一次、状态 consumed，最终仅输出“新结果”。
- 原 60 秒截止时间为 2026-11-09 02:13:27.435 UTC；02:13:33 UTC 再读原生队列为空，最后回合仍为输出“新结果”的回合，没有“旧结果”。
- 三项实际体验覆盖了 AC3 / AC8 的剩余缺口；业务提交已推送且匹配 CI 通过，任务记录和完成态按已确认的发布流程同步。

## 推送后业务 CI

- 业务提交：`fdb4198ccf0475240a5880e15fe9c84dea4f7de1`。
- GitHub Actions：[CI 42550910862](https://github.com/SilentFlower/flower-trellis/actions/runs/42550910862)，headSha 与业务提交完全匹配，status=completed、conclusion=success。
- 8 个 job 均 success：判断验证范围、规则与产物、Ubuntu/Windows Node 22、Ubuntu 24.04 Python 3.8、Ubuntu latest Python 3.12、Windows Python 3.8/3.12。
- Windows Node job 的实际日志确认新时间、并发锁、CLI 帮助及不支持平台诊断用例均执行通过；Unix socket 场景按声明支持范围跳过，不据此宣称 Windows 原生 Codex 唤醒已支持。
- 功能 CI 通过后才写任务完成态与 Close；任务记录提交推送后继续核对其对应 CI，不能把上一提交的绿灯当成新提交的结果。
