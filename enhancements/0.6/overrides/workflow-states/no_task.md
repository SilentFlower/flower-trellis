<!-- BEGIN skill-garden workflow-state no_task v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (no_task):
Creating/resuming a task is not implementation permission.
After PRD ready and task started, next implementation action = `trellis-route(implement)`.
If no active task exists, scan `.trellis/tasks/*/task.json` once per session for in-progress tasks with `last_push_snapshot`; surface completed_steps + next_step and suggest rebinding the active task before resuming.
<!-- END skill-garden workflow-state no_task v0.6 -->
