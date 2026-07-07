# 强化 brainstorm planning gate

## Goal

通过 skill-garden 0.6 的 workflow 注入强化 Trellis planning 阶段规则，明确 `trellis-brainstorm` 是新任务、复杂任务或需求边界不清任务的 Phase 1.1 必经门禁，避免 AI 在 `task.py create` 后把默认 `prd.md` 误判为规划已完成并提前进入 `task.py start`。

## Requirements

### 背景

- 当前 `task.py create` 会创建 planning 工作区和默认 `prd.md`，但默认 `prd.md` 不代表需求已经可实现。
- 用户观察到 AI 有时在需求边界还没讨论清楚时创建 task 并继续推进，没有主动进入 `trellis-brainstorm`。
- 本次优化借助 skill-garden 注入，不改变 `task.py create` / `task.py start` 的生命周期语义。

### 范围

- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 的 hub 中增加简短 `Brainstorm Gate` 规则。
- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/no_task.md` 中合并强化现有 Trellis planning 说明。
- 在 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/planning.md` 和 `planning-inline.md` 中增加一两句 planning 状态提醒。
- 同步生成 `enhancements/0.6` 快照，并按本仓 dogfood 需要同步当前 `.trellis/workflow.md`。

### 确认文案

`workflow.md` hub 新增内容：

```md
#### Brainstorm Gate

`trellis-brainstorm` is the required Phase 1.1 gate for new, complex, or unclear work.

`task.py create` only creates the planning workspace. A default `prd.md` does not mean requirements are ready.

Before `task.py start`, unclear scope, unresolved decisions, or non-testable acceptance criteria must return to `trellis-brainstorm`.
```

`planning.md` / `planning-inline.md` 新增内容：

```md
`trellis-brainstorm` is the default next action while requirements are still unclear.
A created task or existing `prd.md` is not enough to start implementation.
```

`no_task.md` 现有 `EnterPlanMode` 说明改为：

```md
Do NOT call the harness built-in plan mode (`EnterPlanMode` / `ExitPlanMode`) for Trellis planning. It is not a substitute for Trellis task-creation consent, Trellis planning, or the route gate. For new, complex, or unclear work, classify the turn, ask for task-creation consent, then use `trellis-brainstorm`; `task.py create` and the default `prd.md` are not sufficient planning.
```

### 非目标

- 不修改 `task.py create` 自动生成默认 `prd.md` 的行为。
- 不修改 `task.py start` 的状态切换语义。
- 不引入新的 readiness helper 或 SessionStart hook 逻辑。

## Acceptance Criteria

- [x] skill-garden 0.6 源文件包含确认文案，且内容精简。
- [x] `enhancements/0.6` 快照与 skill-garden 源同步。
- [x] 当前 dogfood `.trellis/workflow.md` 中的 skill-garden hub、`no_task`、`planning`、`planning-inline` 注入内容同步更新。
- [x] 修改后文案明确表达：`trellis-brainstorm` 是新任务、复杂任务或需求不清任务的 Phase 1.1 gate。
- [x] 修改后文案明确表达：`task.py create` 和默认 `prd.md` 不等于规划完成。
- [x] 校验命令通过，至少包含快照同步检查和 markdown 文案搜索检查。

## Notes

- 真实源目录是 `vendor/skill-garden/.trellis/0.6/`；不能只改 `enhancements/0.6/` 或当前项目 dogfood 副本。
- 本任务是轻量 workflow 文案增强，当前 PRD 足够指导实现；实现前仍需按 workflow 做 context 配置和 start review。
