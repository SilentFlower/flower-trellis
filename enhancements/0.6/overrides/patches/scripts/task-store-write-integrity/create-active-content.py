    try:
        from .active_task import resolve_context_key, set_active_task
        if resolve_context_key():
            try:
                rel_dir = task_dir.relative_to(repo_root).as_posix()
            except ValueError:
                rel_dir = str(task_dir)
            if set_active_task(rel_dir, repo_root) is None:
                print(colored(
                    "Warning: Task was created, but the active-task pointer could not be persisted.",
                    Colors.YELLOW,
                ), file=sys.stderr)
    except Exception as error:
        print(colored(
            f"Warning: Task was created, but active-task setup failed: {error}",
            Colors.YELLOW,
        ), file=sys.stderr)
