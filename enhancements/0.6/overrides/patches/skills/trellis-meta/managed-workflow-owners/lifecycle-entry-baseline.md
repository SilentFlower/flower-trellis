## Read These Files First

1. `.trellis/workflow.md`
2. `.trellis/config.yaml`
3. `.trellis/scripts/task.py`
4. `.trellis/scripts/common/task_store.py`
5. `.trellis/scripts/common/task_utils.py`
6. The current task's `.trellis/tasks/<task>/task.json`

## Common Needs And Edit Points

| Need | Edit point |
| --- | --- |
| Automatically sync an external system after task creation | `hooks.after_create` in `.trellis/config.yaml`. |
| Automatically update status after task start | `hooks.after_start` in `.trellis/config.yaml`. |
| Run a script after task finish | `hooks.after_finish` in `.trellis/config.yaml`. |
| Clean external resources after archive | `hooks.after_archive` in `.trellis/config.yaml`. |
| Change default task fields | `.trellis/scripts/common/task_store.py`. |
| Change task parsing/search | `.trellis/scripts/common/task_utils.py`. |
| Change active task behavior | `.trellis/scripts/common/active_task.py`. |
