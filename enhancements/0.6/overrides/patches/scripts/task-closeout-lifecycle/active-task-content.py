def _canonical_task_ref(task_path: str, repo_root: Path) -> str | None:
    """Resolve only a top-level task that still belongs to the active view."""
    normalized = normalize_task_ref(task_path)
    if not normalized:
        return None
    full_path = resolve_task_ref(normalized, repo_root)
    if full_path is None or not full_path.is_dir():
        return None
    from .tasks import is_closed_task, load_task

    task = load_task(full_path)
    tasks_dir = repo_root / DIR_WORKFLOW / DIR_TASKS
    if task is None or is_closed_task(task, tasks_dir):
        return None
    try:
        return full_path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(full_path)


def _active_from_ref(
    task_ref: str | None,
    repo_root: Path,
    source_type: str,
    context_key: str | None = None,
) -> ActiveTask | None:
    """Resolve a stored pointer, preserving missing identity while hiding closed tasks."""
    if not task_ref:
        return None
    resolved = resolve_task_ref(task_ref, repo_root)
    if resolved is None or not resolved.is_dir():
        return ActiveTask(normalize_task_ref(task_ref), source_type, context_key, True)
    from .tasks import is_closed_task, load_task

    task = load_task(resolved)
    tasks_dir = repo_root / DIR_WORKFLOW / DIR_TASKS
    try:
        canonical = resolved.relative_to(repo_root).as_posix()
    except ValueError:
        canonical = str(resolved)
    if task is None:
        return ActiveTask(canonical, source_type, context_key, True)
    if is_closed_task(task, tasks_dir):
        return ActiveTask(None, source_type, context_key, True)
    return ActiveTask(canonical, source_type, context_key, False)
