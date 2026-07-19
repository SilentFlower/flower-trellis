[workflow-state:missing_task]
An active task pointer that points to a missing task directory is a recovery-only state, not permission to implement, edit, create a task, start a task, or attribute work to the missing task.
Run `python3 ./.trellis/scripts/task.py finish`. If it fails, report the failure and stop.
If it succeeds, in the same turn treat the current user request as `no_task` and follow `[workflow-state:no_task]` / Request Intent Routing before any edit or task action.
[/workflow-state:missing_task]
