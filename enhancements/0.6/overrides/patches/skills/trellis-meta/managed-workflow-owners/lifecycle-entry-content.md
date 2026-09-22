## Read These Files First

1. `.trellis/workflow.md`
2. `.trellis/config.yaml`
3. `.trellis/scripts/task.py`
4. `.trellis/scripts/common/task_store.py`
5. `.trellis/scripts/common/task_utils.py`
6. `.trellis/scripts/common/active_task.py`
7. `.trellis/scripts/task_progress.py` when saved progress, completion, or reopen behavior is involved
8. The owning `trellis-task-brief`, `trellis-push`, or `trellis-continue` skill for the boundary being changed
9. The current task's `.trellis/tasks/<task>/task.json` and planning artifacts

## Common Needs And Edit Points

| Need | Edit point |
| --- | --- |
| Change planning handoff or activation approval | `trellis-task-brief`, the task-start Brief guard, and planning workflow ownership. |
| Automatically sync an external system after a lifecycle command | The matching `hooks.after_*` entry in `.trellis/config.yaml`. |
| Change default task fields or physical GC movement | `.trellis/scripts/common/task_store.py`, `.trellis/scripts/common/tasks.py`, and `.trellis/scripts/task_lifecycle.py`. |
| Change active task behavior | `.trellis/scripts/common/active_task.py` plus the relevant platform session bridge. |
| Change saved progress validation or lifecycle writes | `.trellis/scripts/task_progress.py` and its owning caller. |
| Change normal completion activation | `trellis-push`, `task_progress.py`, and `[workflow-state:completed]`. |
| Change interruption recovery or candidate rebinding | `trellis-continue` owns the user decision, `task_progress.py` owns candidate evidence, and `task.py start` with `.trellis/scripts/common/active_task.py` owns the explicit session bind; never bind a candidate automatically. |
| Change completed-task rework | The explicit reopen path, then refresh planning artifacts and Brief when scope changed. |
| Change deterministic Close or delayed physical GC | `.trellis/scripts/task_lifecycle.py`, its progress/auto-loop callers, and the SessionStart bridge. |
