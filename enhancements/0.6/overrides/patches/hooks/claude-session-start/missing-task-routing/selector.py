        return (
            f"Status: STALE POINTER\nTask: {task_ref}\n"
            f"Next-Action: Run `python3 ./.trellis/scripts/task.py finish` to clear the stale pointer, "
            "then ask the user what to work on next."
        )
