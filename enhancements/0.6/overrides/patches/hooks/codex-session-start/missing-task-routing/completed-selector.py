    if task_status == "completed":
        return (
            f"Status: COMPLETED\nTask: {task_title}\n"
            f"Next: Archive with `python3 ./.trellis/scripts/task.py archive {task_dir.name}` "
            "or start a new task."
        )
