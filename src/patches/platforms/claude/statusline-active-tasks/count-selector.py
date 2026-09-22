def _count_active_tasks(trellis_dir: Path) -> int:
    """Count non-archived task directories with valid task.json."""
    tasks_dir = trellis_dir / "tasks"
    if not tasks_dir.is_dir():
        return 0
    count = 0
    for d in tasks_dir.iterdir():
        if d.is_dir() and d.name != "archive" and (d / "task.json").is_file():
            count += 1
    return count
