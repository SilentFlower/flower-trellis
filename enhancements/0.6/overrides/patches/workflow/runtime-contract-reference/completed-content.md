<!-- Per-turn breadcrumb: shown while status='completed' and Close is not closed. -->

[workflow-state:completed]
Business work and final task progress are complete, but deterministic Close is still pending or blocked. Do not resume implementation or Update-Spec automatically.
Enter the `trellis-push` completed-task preflight when delivery or task-record publication needs recovery. Otherwise inspect `closeout.blockers`, resolve only the reported condition, and retry `task.py close`; closed tasks disappear from active views immediately.
For rework, obtain an explicit user decision and run `task_progress.py reopen --task <task-name> --json` before returning to `in_progress`. Material scope changes still require refreshed planning artifacts and Brief approval.
[/workflow-state:completed]
