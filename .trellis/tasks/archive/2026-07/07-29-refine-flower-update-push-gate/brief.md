# Brief — 优化 trellis-push 检查门禁与意图识别

## Goal

- 让显式 `push` / `提交` 直接进入一次 Git 计划确认，不再被 Check-All 或 Update-Spec 前置门禁截停，同时修正设计讨论被误判为修改授权的问题。

## Scope

- 修改 `trellis-push`：显式 Push 不再返回 Phase 2.2 或自动进入 Update-Spec，直接执行 Git 预检并生成最小计划。
- 在同一 Push 计划中披露 Check-All 与 Update-Spec 状态；已有 findings、blocked 或 `needs-review` 进入风险区，但不派生额外确认。
- 保持正常 workflow 完成链 `Check-All -> Update-Spec -> Push` 不变。
- 修改 Request Triage owner：按授权、范围确定性、剩余设计决策、副作用和验证复杂度区分 `discuss`、`inspect`、`direct_edit`、`workflow_action` 与 `task_plan`。
- 将 workflow/hook/push/check-all 等影响面作为提高证据和验证要求的风险信号，不作为自动进入 `task_plan` 的关键词规则。
- 从 `vendor/skill-garden/.trellis/0.6/` 源修改并同步 `enhancements/0.6/` 与当前项目受管副本，更新对应契约测试。

## Non-Goals

- 不取消正常开发收尾中的 Check-All 或 Update-Spec。
- 不绕过 exact files、commit message、Git 安全预检和最终执行确认。
- 不让 Flower self-update 自行执行 `git add`、commit 或 push，也不为 Flower update 新增专用分支。
- 不新增 Gate Engine、平行状态机、release 或 publish 行为。

## Key Context

- 历史提交 `1bd0a12` 中“显式跳过 Check-All”的二选一方案已精确回退，`update -y` 修复保留；当前工作区的 rollback diff 是本任务实现基线。
- `trellis-push` 是 Phase 3.4 的 Git owner；Check-All 与 Update-Spec 仍由 Phase 2.2 和 Phase 3.3 各自拥有正常执行流程。
- 显式 Push 只有 Git 层面的确定性问题可以阻断，例如冲突未清零、exact files 无法确定、仓库或 upstream 状态不满足安全执行条件。
- Request Triage 是自然语言意图的 policy owner；no-task 和 workflow-state 只保留一跳路由，避免复制完整分类规则。
- 0.6 修改顺序固定为 vendor source -> `npm run sync` -> 发布快照/当前项目副本一致性检查。
- `.flower/` 当前未跟踪状态不属于本任务范围，不清理、不提交。

## Acceptance

- 显式 Push 在 Check-All 或 Update-Spec 缺失、失效、失败或需复核时仍生成 Push 计划，且只要求原有的一次最终确认。
- Push 计划展示 Check-All 状态、Update-Spec 状态、exact files、commit message、保留 dirty 和风险。
- 正常完成链仍按 `Check-All -> Update-Spec -> Push` 执行。
- “你觉得怎么改/方案不舒服”进入 `discuss`，“检查原因”进入 `inspect`；明确、范围已知且无需设计决策的修改或回退不会仅因影响面较大被强制升级为任务规划。
- owner 唯一性、Request Intent routing、Update-Spec/Push 交互、源与快照一致性、Patch targets 和 AI context budget 测试通过。

## Next Step

- 实现与聚焦验证已完成；当前进入 full Check-All，检查通过后按正常流程进入 Update-Spec。
