    if task_status == "completed":
        return (
            f"Status: COMPLETED\nTask: {task_title}\n"
            "Next: Load trellis-continue. It routes incomplete publication through trellis-push "
            "and retries deterministic Close only after structured blockers are resolved."
        )
