# 后台确认演练实施计划

## Scope And Gates

最新完整 Brief 已展示并取得用户“确认”；任务已激活为 in_progress，trellis-route 已解析 inline 实施。后续增量修复沿用该批准范围，不重复请求整个 Brief 确认。

## Implementation

- [x] 实施前重新读取任务材料和 `trellis-before-dev`；保留现有工作区及其它会话的变更。
- [x] 实现单 session 的有界状态记录、目录锁、同目录原子替换与请求代次；网络和等待不进入锁内。
- [x] 基于已验证的 `ws` 接入现有 daemon，核对精确 session / 项目，订阅用户消息和原回合结束事件。
- [x] 实现后台 worker 的 prepared、waiting、dispatching、queued、cancelled / failed 转换，以及正常回合结束后才开始计时。
- [x] 实现带回执的原生队列投递、精确撤回和领取一次；回执未知不盲目重发。
- [x] 实现本项目 `wait` / `claim` / `cancel` / `status` 命令及帮助。非法参数、缺少 session、无现存 daemon 或不支持平台明确失败。
- [x] 显式声明 `ws` 直接依赖并保持当前版本，不更改 Node 兼容范围或其它依赖。
- [x] 在 AGENTS 项目自有段加入主动演练入口和内部唤醒处理，保留受管块；补充可直接给新 Codex 使用的演练提示。

## Validation

- [x] Node 内置测试验证时间参数、状态持久化、用户消息去重、同 session 替换、跨 session 隔离、重复 worker 和重复领取。
- [x] 使用本地模型替身和真实 Codex managed daemon 验证无人回复、提前回复、消息已入队、同一时刻到期与回复、断连和投递结果未知。
- [x] 原生工具按短 yield 返回后台 session 后，主回合确实结束，计时期间用户新消息可以正常成为新回合；不通过同步轮询取得“通过”。
- [x] 验证未主动请求演练时，Brief、Check 与 Push 人工门禁及当前任务状态均不改变。
- [x] 为新增入口核对 `scripts/ci-impact.mjs` 与 Node 测试清单。通用状态和平台诊断在 Ubuntu / Windows 执行；原生 Linux/WSL 支持范围独立记录，未验证平台不声称通过。
- [x] 运行新增模块语法检查与定向测试；运行时与依赖变化按规范执行一次 `npm test`，修复失败后仅按影响补跑。
- [x] 使用当前项目的新 Codex 会话试用两个不同时长、回复修改和状态查询；所有演练只输出文本，不运行真实业务默认动作。

## Review And Delivery

- [x] 通过 `trellis-route(target=check)` 进入 Check-All，按实际影响验证，复用本轮有效证据。
- [x] 按完成链评估 Spec，展示精确 Push 计划；未经确认不提交或推送。
- [x] 涉及可执行行为的提交推送后，等待当前提交的必需 CI 结果，再作兼容和任务完成结论。

## Rollback

取消当前项目的待处理请求并终止自有 worker，删除对应本地演练状态；回退本次脚本、内部模块、AGENTS 自有段与直接依赖声明。保留既有 Codex 配置、受管 Hook、其它会话以及真实任务与 Git 状态。

## Current Evidence

- 定向与原生工具链证据见 `research/implementation-verification.md`；本轮完整回归已通过。用户实际会话的到期续接、中途取消和改时重建均已复核通过，AC3 / AC8 的体验缺口已消除；本轮以轻量补验承接既有全面检查。功能提交已按确认范围推送，匹配的 8 项 CI 全部成功；任务记录与 Close 由本轮已确认的发布流程同步，最终记录提交的 CI 另行回读。
