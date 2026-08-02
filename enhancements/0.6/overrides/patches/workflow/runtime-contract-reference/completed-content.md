<!-- Per-turn breadcrumb: shown while status='completed'.
     Normal trellis-push has completed all business pushes, synchronized final
     task progress, and then activated completed locally. The task remains active until an explicit
     trellis-finish-work archive succeeds. -->

[workflow-state:completed]
Business push and task progress are complete. Do not resume implementation, Update-Spec, or trellis-push automatically.
Run `/trellis:finish-work` only when explicitly requested; it verifies the completed record and archives the task without rewriting completion metadata.
For rework, obtain an explicit user decision and run `task_progress.py reopen --task <task-name> --json` before returning to `in_progress`. Material scope changes still require refreshed planning artifacts and Brief approval.
[/workflow-state:completed]
