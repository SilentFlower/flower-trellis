def _validate_planning_brief(full_path, task_json_path) -> bool:
    """Validate that a planning task has a fresh derived brief before start.

    Args:
        full_path: Absolute task directory path.
        task_json_path: Absolute path to the task metadata file.

    Returns:
        True when start may continue, otherwise False.
    """
    try:
        task_json_exists = task_json_path.is_file()
    except OSError as error:
        print(colored(f"Error: Unable to validate planning task status: {error}", Colors.RED))
        print("Hint: Fix task metadata access before retrying task.py start.")
        return False

    if not task_json_exists:
        return True

    data = read_json(task_json_path)
    if not data:
        print(colored("Error: Unable to read task status for brief validation.", Colors.RED))
        print("Hint: Fix task.json before retrying task.py start.")
        return False
    if data.get("status") != "planning":
        return True

    brief_path = full_path / "brief.md"
    try:
        if not brief_path.is_file():
            print(colored("Error: Planning task brief.md is missing.", Colors.RED))
            print("Hint: Run trellis-task-brief, display the full brief, and wait for user confirmation before retrying task.py start.")
            return False
        brief_mtime = brief_path.stat().st_mtime_ns
        authoritative_paths = [
            full_path / name
            for name in ("prd.md", "design.md", "implement.md")
            if (full_path / name).is_file()
        ]
        stale_sources = [
            path.name
            for path in authoritative_paths
            if path.stat().st_mtime_ns > brief_mtime
        ]
    except OSError as error:
        print(colored(f"Error: Unable to validate planning brief freshness: {error}", Colors.RED))
        print("Hint: Fix task artifact access, then refresh and review brief.md before retrying task.py start.")
        return False

    if stale_sources:
        print(colored(
            f"Error: Planning task brief.md is stale; newer artifacts: {', '.join(stale_sources)}.",
            Colors.RED,
        ))
        print("Hint: Run trellis-task-brief, display the refreshed brief, and wait for user confirmation before retrying task.py start.")
        return False

    return True


def _prepare_start_status(task_json_path):
    """Persist planning -> in_progress before binding the session pointer.

    Args:
        task_json_path: Absolute path to the task metadata file.

    Returns:
        Tuple of original metadata, whether status changed, and success status.
    """
    if not task_json_path.is_file():
        return None, False, True
    data = read_json(task_json_path)
    if not data:
        print(colored("Error: Unable to read task.json before start.", Colors.RED))
        return None, False, False
    if data.get("status") != "planning":
        return None, False, True
    original = dict(data)
    updated = dict(data)
    updated["status"] = "in_progress"
    if not write_json(task_json_path, updated):
        print(colored("Error: Failed to persist task status before start.", Colors.RED))
        return original, False, False
    return original, True, True


def _restore_start_status(task_json_path, original) -> bool:
    """Restore task metadata after session pointer binding fails.

    Args:
        task_json_path: Absolute path to the task metadata file.
        original: Metadata captured before the status transition.

    Returns:
        True when no restore is needed or the original metadata was written.
    """
    return original is None or write_json(task_json_path, original)
