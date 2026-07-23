# Brief — 优化实现后检查卡点与暂缓状态

## Goal

- 调整 Trellis Phase 2 的默认节奏：首次实现自动进入 Check-All，首次检查后的追加修改可在下一次检查前暂缓，同时保证用户不会忘记最终检查，且 auto-loop 始终连续推进。

## Scope

- 在 Phase 2.1 与 Phase 2.2 之间增加 Pre-Check 软偏好：首次实现默认继续检查；首次 Check-All 后的第一条追加修改开始持有 `hold`。
- 暂缓期间优先实现用户反馈并做定向验证，可延后同步 PRD、design、implement 和 brief；每轮交付附带简短、非提问式的后续检查引导。
- 新增 session/window scoped 的 `pre_check_state.py` helper，只持久化当前任务的 `hold`，支持 `status`、`hold`、`clear` 和结构化错误。
- 在同一会话压缩或 resume 时条件恢复暂缓提示；新 AI session 不继承，且无状态时不增加 SessionStart 动态上下文。
- 当前消息中的明确继续或暂缓意图覆盖持久化偏好；进入 Check-All、切换任务、完成或归档时清除或忽略旧状态。
- 启动或恢复 auto-loop 时静默清除交互式 `hold`；validated runner 继续按既有 outstanding action 推进。
- 从 `vendor/skill-garden/.trellis/0.6` 修改强化源，经 `npm run sync` 生成 `enhancements/0.6`，再同步 dogfood workflow、hooks、scripts 和平台 skills。

## Non-Goals

- 不改变 Check-All 的 audit-only、collect-all、问题严重度、修复范围确认、修复后重检和最终检查深度。
- 不改变 Interactive Post-Check Stop Gate；本任务只处理进入 Check-All 之前的卡点。
- 不修改 auto-loop runner 的 action schema、三轮 fix/recheck 预算、队列、提交授权或归档策略。
- 不把暂缓偏好写入任务文档、journal 或长期团队配置，也不维护穷举式自然语言关键词表。
- 不要求追加修改期间每轮立即同步规划文档。

## Key Context

- Runtime 状态复用 `.trellis/.runtime/sessions/<context-key>.json`，字段携带版本、当前任务、`hold` 模式、来源和更新时间；只读取当前 context key，不扫描其它 session。
- 状态 helper 复用 `common.active_task.resolve_active_task`，负责当前任务校验、原子写入和损坏保护；AI 与 hook 不直接解析或修改 runtime JSON。
- 决策优先级为：validated auto-loop、当前消息明确继续、当前消息明确暂缓、匹配的持久化 `hold`、默认继续检查。
- Workflow hub 和高频 state 只保留最短跨阶段边界；完整规则放在 Phase walkthrough、helper 和 skill，避免重复注入 token。
- SessionStart 仅在当前任务存在匹配 `hold` 时增加一条可覆盖提示；helper 缺失或读取失败时静默退化为默认检查。
- Check-All 一旦开始，`CHK-*` 修复继续走既有修复与重检循环，不再受 Pre-Check 偏好拦截。
- 关键规范为 `.trellis/spec/flower-trellis/cli/index.md`、`enhancements-model.md` 和 `ai-context-budget.md`。

## Acceptance

- 首次 Phase 2.1 完成后，在用户没有明确暂缓时自动进入 `trellis-route(target=check)`，不会提前结束。
- 首次 Check-All 后的第一条追加修改立即进入暂缓；修改完成后只做定向验证，并持续输出自然、简短、非提问式的检查引导。
- 明确的“先不检查”可跨同一 session/window 的压缩与 resume 恢复；全新 session 不继承。
- “下一步”“可以检查了”“提交”“部署”等明确继续语义可覆盖并清除 `hold`，直接进入检查或后续流程。
- 现有 Post-Check Stop Gate、Check-All 修复重检和最终审计行为无回归。
- 陈旧交互式 `hold` 不改变 auto-loop 的 `run_implement -> run_check_all` 与 `run_fix -> run_recheck`；启动或恢复 auto-loop 不新增确认卡点。
- 无 `hold` 时 SessionStart 零动态增量，有匹配状态时仅增加一条提示；任务不匹配、状态损坏或不同 context key 均不注入。
- vendor 源、`enhancements/0.6`、`.agents`、`.claude`、dogfood scripts/hooks/workflow 保持一致。
- helper、hook、workflow、安装和 auto-loop 相关测试通过；`npm test`、默认与 strict AI context budget、语法检查和 `git diff --check` 全部通过。

## Next Step

- 用户确认本 brief 与 planning artifacts 后，运行 `task.py start` 激活任务，再按 `trellis-route(target=implement)` 进入实现；首次实现完成后按新契约自动进入 Check-All。
