<!-- BEGIN skill-garden workflow-state no_task v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (no_task):
Creating/resuming a task is not implementation permission.
After PRD ready and task started, next implementation action = `trellis-route(implement)`.
If no active task exists, scan `.trellis/tasks/*/task.json` once per session for in-progress tasks with `last_push_snapshot`; surface completed_steps + next_step and suggest rebinding the active task before resuming.
Do NOT use the harness built-in plan mode (`EnterPlanMode` / `ExitPlanMode`) as a substitute for this gate. Planning is Trellis-only: classify the turn, ask for task-creation consent, then `trellis-brainstorm` for complex work.
If the turn is a meta edit to Trellis itself (Trellis tracking would be overkill), say so and ask to skip Trellis — never silently swap built-in plan mode in for the consent gate.
<!-- END skill-garden workflow-state no_task v0.6 -->
