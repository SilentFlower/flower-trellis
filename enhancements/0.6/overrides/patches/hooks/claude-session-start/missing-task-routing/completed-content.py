    if task_status == "completed":
        return (
            f"Status: COMPLETED\nTask: {task_title}\n"
            f"Present: {present_line}\n"
            "Next-Action: Load trellis-continue. It routes incomplete publication through trellis-push "
            "and retries deterministic Close only after structured blockers are resolved."
        )
