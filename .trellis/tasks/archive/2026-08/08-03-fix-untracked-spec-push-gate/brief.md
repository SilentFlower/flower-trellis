# Brief — 简化 Untracked 流程游标与 Push 路由

## Goal

- 把 untracked 收缩为 session 级流程游标，只负责引导 Agent 按 `implement -> check -> spec -> push` 进入正确 owner，不再用工作区指纹、scope 或证据链阻止流程。

## Scope

- 精简 `untracked_flow.py` 状态和 CLI：保留事项标识、摘要、来源、阶段、时间戳以及 `begin/status/advance/session-start-hint/clear`。
- 删除 `prepare-edit`、`record-validation`、`record-check`、`record-spec` 及 baseline、scope、fingerprint、focused validation、Check-All、Update-Spec evidence 状态。
- 让实现、Check-All、Update-Spec 和 Trellis Push owner 只在阶段切换时更新游标；真实检查和安全规则继续由各 owner 负责。
- 按 untracked stage 注入一跳面包屑；`stage=push` 必须明确加载 `trellis-push`，不能被解释为 Push 已执行。
- 简化 task adoption：不验证 untracked fingerprint，在 adoption 当下重新捕获 task baseline。
- 修改 Skill-Garden 0.6 authoring source，同步 `enhancements/0.6` 并刷新 dogfood、平台副本、规范和测试。

## Non-Goals

- 不新增 `prepare-spec`、exact-path fingerprint 排除或受控规范写入批次。
- 不新增 `push_gate.py`、确认令牌、confirmed/authorized 状态或 Git 拦截器。
- 不把 untracked 做成审计事务、证明链或迷你任务系统。
- 不放松 `trellis-push` 自身的正式计划、用户确认、精确文件范围和 Git 安全检查。
- 不改变 auto-loop、任务 progress、finish-work、release/deploy、0.5 或 old 行为。

## Key Decisions

- Untracked 的唯一职责是“下一步路由到哪里”，不是“证明上一步已经完成”。
- `advance --stage` 只更新游标，并允许发现问题或发生新编辑时回到 `implement`。
- `begin` 直接进入 `implement`；旧 v1 `inspect` 状态兼容映射到 `implement`。
- Check-All、Update-Spec 和 Push 不再向 untracked helper 写证据。它们现有的 owner 契约继续决定 pass/fail、规范结果与 Git 副作用。
- Push 采用阶段专用面包屑解决路由问题，不增加第二套运行时门禁。
- Task 需要严格 baseline 时，在 adoption 边界重新捕获；不复用 untracked 的 workspace fingerprint。

## Key Context

- 当前 `untracked_flow.py` 把 baseline、scope、完整 workspace fingerprint 和三段 owner evidence 组合成状态机，导致合法 Update-Spec 写入也会触发 `workspace-drift`。
- 当前 per-turn hook 对所有 untracked stage 固定选择同一个 `[workflow-state:untracked]`，Push 入口只是一句埋在通用正文里的提示。
- 主要产品源位于 `vendor/skill-garden/.trellis/0.6/`，涉及 `untracked_flow.py`、`task_intent.py`、workflow/skill Patch、per-turn hook、测试和 CLI 规范。
- `enhancements/0.6` 与根项目运行副本必须从 vendor source 通过 sync/dogfood 生成，不能单独手工维护。

## Risks / Deferred

- 旧 v1 runtime 仍可能包含大量证据字段；兼容层必须忽略这些字段并稳定迁移，避免要求用户手工清理 session。
- 本任务只简化 untracked；Trellis Push 自身的 Git 门禁保持原样，其进一步重构不在本轮范围。

## Acceptance

- 无任务工作能按 `implement -> check -> spec -> push` 恢复和推进，findings 可返回 `implement`。
- 工作区或规范文件变化不会再触发 untracked `workspace-drift`，owner 文案不再调用四个旧证据命令。
- 四个阶段分别注入正确的一跳面包屑；`stage=push` 明确加载 `trellis-push`，不重放上游步骤。
- `trellis-push` 既有计划、确认、精确文件和 Git 检查不变，不新增 push gate helper。
- 旧 v1 runtime 与 task adoption 兼容；adoption 使用当前工作区重新建立 task baseline。
- vendor、snapshot、dogfood 和平台副本一致，定向测试、全量测试、同步、冲突、context budget、diff check 与任务校验通过。

## Next Step

- 实现已完成，当前进入 full Check-All；按检查报告处理 findings 后重检。
