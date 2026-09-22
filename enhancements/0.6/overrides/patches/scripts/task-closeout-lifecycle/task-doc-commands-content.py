    python3 task.py close <task> [--resolve-blocker <code>] [--json]  # Close completed task
    python3 task.py gc --closed [--before 3d]   # Move expired closed tasks
    python3 task.py restore <task> [--json]     # Restore physical task location
    python3 task.py list [--closed|--all]       # List task lifecycle views
