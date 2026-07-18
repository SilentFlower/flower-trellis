# Brief — 升级 Check-All 智能检查与 Auto-Loop 续跑

## Goal

- 保持 `trellis-check-all` 为统一检查入口，由它智能选择 light/full 深度，并确保 validated running auto-loop 在检查后按 runner `record + next` 自动续跑。

## Scope

- 扩展 Check-All 的 requested/effective depth、hard-full 安全底线、light eligibility、fallback full、可解释 profile 和单向升级规则。
- 所有普通、显式轻量/全量、最终检查和 auto-loop `run_check_all` 都进入 Check-All；`trellis-route` 只决定 inline/subagent。
- 为 auto-loop 增加运行级 `check-depth=auto|light|full`，记录实际 effective depth，并保持 pass/fail/recheck/spec_update/commit_only 状态机兼容。
- 把 Auto-Loop Return Gate 提升到 Interactive Post-Check Stop Gate 之前，并收紧 workflow hub 与两个 in-progress state 的高频文案。
- 修改 vendor 0.6 agents/claude skill、workflow/state、`auto_loop.py`，同步 enhancements 和当前 dogfood 副本，新增 runner 与静态契约测试。

## Non-Goals

- 不改变 implement 的 inline/subagent 路由。
- 不让 Check-All 执行 commit、push、finish-work 或归档。
- 不调整 auto-loop commit-only 文件归属、队列模型或默认三轮 fix/recheck 预算。
- 不修改 0.5 / old 路径，不把语义判断整体脚本化。

## Key Context

- Check-All 当前已有局部低风险/完整路径雏形，本轮是强化判定、输出和正式门禁语义，不是从零新增第二套检查器。
- 显式 light 不能突破 migration、安全、发布、schema/持久化、回滚、full 重检等 hard-full 信号；升级时记录 requested/effective depth。
- 高置信 light 通过正式满足检查门禁；歧义默认 full，不询问。
- 新 auto-loop run 默认 `check_depth=auto`；历史 state 缺字段按 full 兼容。
- `run_check_all` 名称保留，代表 Check-All 统一入口；route-check 继续只代表执行位置。
- Auto-loop inline 由 Check-All 立即 `record + next`；subagent 返回后由主会话立即完成同样动作，不能先套用 interactive stop。
- 真实源在 `vendor/skill-garden/.trellis/0.6/`；父仓快照由 `npm run sync` 生成。高频 prompt 增量必须满足 AI context budget 去重约束。

## Acceptance

- light/full 自动选择、用户覆盖、hard-full escalation、fallback full 和 full recheck 不降级均有可验证结果。
- Interactive 检查正常停止；running auto-loop pass/fail/blocked 分别进入 next、run_fix 或真实阻塞，多子任务不逐个等待确认。
- `check-depth=auto|light|full` 可审计、可恢复，并与 check-all inline/subagent 正交。
- 顶层 `trellis-check` 轻量逃生口移除，内部复用保持 audit-only。
- workflow hub、state guards、Check-All、route、auto-loop skill/runner 语义一致。
- vendor、agents/claude、enhancements、dogfood 同步且幂等；Node/Python 测试、语法、snapshot 和默认/strict context budget 通过。

## Next Step

- 用户确认本 brief 和三件套后运行 `task.py start 07-18-check-all-smart-depth`，随后进入 `trellis-route(implement)`；不得在确认前实施。
