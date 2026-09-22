  python3 task.py close <task> [--resolve-blocker <code>] [--json]  Close a completed task
  python3 task.py gc --closed [--before 3d]          Move expired closed tasks
  python3 task.py restore <task> [--json]            Restore physical task location
  python3 task.py add-subtask <parent> <child>       Link child task to parent
  python3 task.py remove-subtask <parent> <child>    Unlink child from parent
  python3 task.py list [--closed|--all] [--mine] [--status <status>] [--json]
