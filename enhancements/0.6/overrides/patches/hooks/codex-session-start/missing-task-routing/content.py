        return (
            f"Status: MISSING TASK POINTER\nTask: {task_ref}\n"
            "Next: Run python3 ./.trellis/scripts/task.py finish. If cleanup fails, report it and stop. "
            "If cleanup succeeds, treat the current request as NO ACTIVE TASK in the same turn and "
            "follow no_task Request Intent Routing before any edit, task creation, or task start."
        )
