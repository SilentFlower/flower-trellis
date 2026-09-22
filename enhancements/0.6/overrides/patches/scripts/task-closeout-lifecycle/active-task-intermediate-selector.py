) -> ActiveTask | None:
    """Resolve a stored pointer and hide missing or logically closed tasks."""
    if not task_ref:
        return None
    resolved = resolve_task_ref(task_ref, repo_root)
    if resolved is None or not resolved.is_dir():
        return ActiveTask(None, source_type, context_key, True)
    from .tasks import is_closed_task, load_task

    task = load_task(resolved)
    if task is None or is_closed_task(task, get_tasks_dir(repo_root)):
        return ActiveTask(None, source_type, context_key, True)
    try:
        canonical = resolved.relative_to(repo_root).as_posix()
    except ValueError:
        canonical = str(resolved)
    return ActiveTask(canonical, source_type, context_key, False)
