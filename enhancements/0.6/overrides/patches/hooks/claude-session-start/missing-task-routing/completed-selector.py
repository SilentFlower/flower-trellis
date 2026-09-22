    if task_status == "completed":
        return (
            f"Status: COMPLETED\nTask: {task_title}\n"
            f"Present: {present_line}\n"
            "Next-Action: Run `/trellis:finish-work`. If the working tree is dirty, return to Phase 3.4 first."
        )
