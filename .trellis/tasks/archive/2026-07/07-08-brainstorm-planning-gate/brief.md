# Brief — 强化 brainstorm planning gate

## Goal

- 通过 skill-garden 0.6 的 workflow 注入强化 Trellis planning 阶段规则，明确 `trellis-brainstorm` 是新任务、复杂任务或需求边界不清任务的 Phase 1.1 必经门禁，避免 AI 把 `task.py create` 后的默认 `prd.md` 误判为规划已完成。

## Scope

- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 的 hub 中增加简短 `Brainstorm Gate` 规则。
- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/no_task.md` 中合并强化现有 Trellis planning 说明。
- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/planning.md` 和 `planning-inline.md` 中增加简短 planning 状态提醒。
- 同步生成 `enhancements/0.6` 快照，并同步当前 dogfood `.trellis/workflow.md`。

## Non-Goals

- 不修改 `task.py create` 自动生成默认 `prd.md` 的行为。
- 不修改 `task.py start` 的状态切换语义。
- 不引入新的 readiness helper 或 SessionStart hook 逻辑。

## Key Context

- 真实源目录是 `vendor/skill-garden/.trellis/0.6/`；不能只改 `enhancements/0.6/` 或当前项目 dogfood 副本。
- 本任务是轻量 workflow 文案增强，文案需保持精简。
- `workflow.md` hub 新增 `Brainstorm Gate`，强调 `trellis-brainstorm`、`task.py create` 和默认 `prd.md` 的关系。
- `planning.md` / `planning-inline.md` 只补一两句，避免 workflow-state 变长。

## Acceptance

- skill-garden 0.6 源文件包含确认文案，且内容精简。
- `enhancements/0.6` 快照与 skill-garden 源同步。
- 当前 dogfood `.trellis/workflow.md` 中的 skill-garden hub、`no_task`、`planning`、`planning-inline` 注入内容同步更新。
- 修改后文案明确表达：`trellis-brainstorm` 是新任务、复杂任务或需求不清任务的 Phase 1.1 gate。
- 修改后文案明确表达：`task.py create` 和默认 `prd.md` 不等于规划完成。
- 校验命令通过，至少包含快照同步检查和 markdown 文案搜索检查。

## Next Step

- 确认 planning artifacts 和本 brief 后，运行 `task.py start`，再进入实现阶段修改 skill-garden 源、同步快照和 dogfood workflow。
