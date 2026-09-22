def cmd_close() -> None:
    """Mark the linked Linear issue done after deterministic task Close."""
    task, _ = _read_task()
    issue = _get_linear_issue(task)
    if not issue:
        return
    _linearis("issues", "update", issue, "-s", STATUS_DONE)
    print(f"Updated {issue} -> {STATUS_DONE}")
