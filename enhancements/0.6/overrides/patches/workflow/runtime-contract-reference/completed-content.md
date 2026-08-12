<!-- Per-turn breadcrumb: shown while status='completed'.
     The task remains active until the Push-owned completed preflight resolves
     publication recovery or explicit trellis-finish-work archive succeeds. -->

[workflow-state:completed]
Business work and final task progress are complete, but `status=completed` alone does not prove that a normal task-record commit was pushed. Do not resume implementation or Update-Spec automatically.
Enter the `trellis-push` completed-task preflight for the single next hop. It either prepares publication recovery, points to explicit `/trellis:finish-work`, or blocks on ambiguous evidence; this state does not inspect Git or auto-loop details itself.
For rework, obtain an explicit user decision and run `task_progress.py reopen --task <task-name> --json` before returning to `in_progress`. Material scope changes still require refreshed planning artifacts and Brief approval.
[/workflow-state:completed]
