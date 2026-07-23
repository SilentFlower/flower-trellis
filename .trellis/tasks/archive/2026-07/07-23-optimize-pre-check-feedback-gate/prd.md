# 优化实现后检查卡点与暂缓状态

## Goal

优化 Trellis Phase 2 的交互节奏：首次实现默认完整进入 Check-All；用户进入连续调整阶段时，在下一次 Check-All 之前形成可恢复但不僵化的卡点，减少重复检查、文档同步和上下文消耗，同时保持 auto-loop 的连续推进能力。

## Background

- 当前 Phase 2.1 完成后没有明确规定首次实现必须自动进入 Phase 2.2，模型可能把 Check-All 当作可选下一步并提前结束。
- 用户在首次交付后可能连续提出多轮 UI、交互或业务细节修改。每轮都执行完整 Check-All 会拉长流程，并反复暴露规划文档漂移。
- 只依赖对话语义判断无法跨上下文压缩稳定恢复；把暂缓状态写成硬锁又会压过用户的新意图，导致流程僵化。
- 当前 Interactive Post-Check Stop Gate 属于 Check-All 输出后的既有边界，不是本任务要解决的“进入 Check-All 前”卡点。

## Requirements

### R1. 首次实现默认进入检查

- 任务首次完成 Phase 2.1 实现和定向验证后，默认继续进入 Phase 2.2 Check-All。
- 不得把 Check-All 表述为“需要的话可以继续”的可选步骤。
- 用户在当前请求中明确表示“先不检查”时，可以覆盖首次默认行为。

### R2. 追加修改可暂缓下一次检查

- 用户在已有实现基础上继续提出产品、UI、交互或业务调整时，允许在修改和定向验证完成后停在下一次 Check-All 之前。
- 首次 Check-All 之后的第一条追加修改即进入暂缓，不等待检测第二条连续修改，也不维护修改次数计数。
- 暂缓期间继续优先实现用户反馈，不要求每轮立即同步 PRD、design 或 brief；最终 Check-All 仍需识别并报告文档漂移。
- 卡点不得机械询问“是否检查”。暂缓状态下每次完成实现和定向验证后，都必须附带一条简短方向提示：用户可以继续修改；准备检查时可表达“下一步”或“可以检查了”。
- 引导必须是陈述式提示，不要求用户当场二选一，也不得使用“收口”等不自然表述。
- 用户在同一请求中表达“改完检查”“提交”“部署”或其它明确继续流程的语义时，不进入暂缓。

### R3. 暂缓状态是可覆盖的软偏好

- 只持久化当前任务的 `hold` 倾向，不持久化“禁止检查”或默认 `proceed` 状态。
- 当前用户消息的最新明确意图必须高于持久化偏好。
- 明确继续流程时清除偏好并进入 Check-All；明确继续调整时设置或保留偏好。
- Check-All 开始、任务切换、任务完成或归档时清除当前任务的暂缓偏好。
- 状态缺失、损坏或任务不匹配时安全退化为默认进入 Check-All。

### R4. 跨压缩恢复且控制注入预算

- 暂缓偏好保存在 gitignored、session/window scoped 的 runtime 中，不写入 `task.json`、任务文档或 Git。
- 同一会话压缩或 resume 后必须恢复当前任务的暂缓偏好。
- 暂缓偏好不跨全新的 AI session 继承；新 session 缺少匹配状态时默认进入 Check-All，避免陈旧偏好长期影响任务。
- 只有偏好存在时才向 SessionStart/恢复上下文注入一条精简提示；没有偏好时不得增加动态注入。
- 高频 workflow hub/state 只保留必要的一句边界，完整解析、状态读写和错误矩阵归属 helper/skill。
- 最终 dogfood 文件和真实 SessionStart/Phase 输出必须通过 AI context budget 检查，不得只测 Patch source。

### R5. 保留现有 Check-All 后置边界

- 不修改 Interactive Post-Check Stop Gate 的审计后停止语义。
- 不改变 Check-All audit-only、collect-all、修复范围确认、修复后重检及最终检查深度规则。
- Check-All 发现的问题修复属于质量修复循环，不得重新进入本任务新增的 Pre-Check 卡点。

### R6. Auto-loop 隔离

- Validated auto-loop 继续以 runner outstanding action 为权威，不读取交互式暂缓偏好。
- 正常 action 链保持 `run_implement -> run_check_all` 和 `run_fix -> run_recheck`，不引入 Pre-Check 交互卡点。
- 用户启动或恢复 auto-loop 表示明确继续自动流程；应静默清除当前任务的交互式暂缓偏好，不得再次询问确认，也不得被陈旧偏好阻断。
- auto-loop 运行期间用户明确要求暂缓检查时，应使用 runner 的 blocked/retry 机制，不把该状态混入交互式软偏好。
- 不修改 runner 的 action 名称、检查深度、三轮 fix/recheck 预算或 commit-only 授权边界。

### R7. 增强层与平台一致性

- 改动以 `vendor/skill-garden/.trellis/0.6` 为强化源权威，通过 `npm run sync` 生成 `enhancements/0.6` 发布快照，再同步 dogfood `.agents` / `.claude` 副本和最终 workflow。
- 不允许只修改 `enhancements/0.6` 快照、生成后的 `.trellis/workflow.md` 或单个平台 skill。
- 状态 helper 必须负责 session context key、当前任务校验、原子写入和结构化错误；AI 不得手改 runtime JSON。

## Acceptance Criteria

- [ ] 首次 Phase 2.1 完成且用户未暂缓时，同一流程继续进入 `trellis-route(target=check)`，不会提前结束。
- [ ] 用户明确“先不检查”后，即使发生上下文压缩，恢复时仍停在 Check-All 前。
- [ ] 同一 session/window 的压缩与 resume 可以恢复暂缓偏好；全新 session 不继承旧偏好。
- [ ] 持久化偏好存在时，用户表达“下一步”“可以检查了”“提交”或等价语义可以立即覆盖并清除偏好。
- [ ] 第一条追加修改即进入暂缓；追加修改期间只做定向验证，不反复运行完整 Check-All。
- [ ] 暂缓期间每次实现完成后都输出一条自然、简短、非提问式的检查引导，避免用户遗忘后续 Check-All。
- [ ] Check-All 已经开始后，现有 audit-only Post-Check Stop Gate 行为保持不变。
- [ ] `CHK-*` 修复完成后继续重检，不被 Pre-Check 偏好拦截。
- [ ] Validated auto-loop 在存在陈旧交互偏好时仍按 runner 进入 `run_check_all` / `run_recheck`。
- [ ] 启动或恢复 auto-loop 会静默清除当前任务的交互式暂缓偏好，不增加确认卡点。
- [ ] auto-loop action schema、检查深度、重试预算和 commit-only 行为无回归。
- [ ] 暂缓偏好不存在时，SessionStart 不增加对应动态提示；存在时只增加一条精简提示。
- [ ] 任务切换、检查开始、完成和归档能够清除或忽略不匹配状态。
- [ ] vendor 强化源、`enhancements/0.6` 发布快照、`.agents`、`.claude` 和 dogfood 产物保持一致。
- [ ] `npm test`、默认/strict AI context budget、相关 Python/JS 语法检查与 `git diff --check` 通过。

## Out Of Scope

- 改写 Check-All 的问题模型、严重度、审计维度或修复范围确认。
- 改变 auto-loop runner 的 action 链、队列并发、提交授权或归档策略。
- 把交互式暂缓偏好写入任务文档、开发者 journal 或长期团队配置。
- 为每种自然语言表达维护穷举关键词表；最终决策仍由 AI 结合最新用户语义完成。
- 每轮追加修改都立即同步 PRD、design、implement 或 brief。
