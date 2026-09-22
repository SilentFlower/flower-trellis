

def _resolve_task_reference_from_records(
    task_ref: str,
    repo_root: Path,
    records,
    scope_name: str,
) -> Path:
    """Resolve one task reference from an explicit lifecycle record scope."""
    raw = task_ref.strip() if isinstance(task_ref, str) else ""
    if not raw:
        raise ValueError("任务引用不能为空")

    tasks_dir = get_tasks_dir(repo_root).resolve()
    normalized = raw.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    candidate = Path(raw)
    path_reference = candidate.is_absolute() or "/" in normalized or normalized.startswith(".trellis")
    if path_reference:
        candidate = candidate if candidate.is_absolute() else repo_root / Path(normalized)
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError) as error:
            raise ValueError(f"无法解析任务引用：{task_ref}") from error
        if candidate.is_symlink() or resolved.parent != tasks_dir or resolved.name == "archive":
            raise ValueError(f"任务引用必须指向{scope_name}：{task_ref}")
        if not resolved.is_dir():
            raise ValueError(f"任务不存在：{task_ref}")
        matches = [task.directory.resolve() for task in records if task.directory.resolve() == resolved]
    else:
        matches = [
            task.directory.resolve()
            for task in records
            if task.dir_name == raw or task.dir_name.endswith(f"-{raw}")
        ]

    matches = sorted(set(matches))
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(path.name for path in matches)
        raise ValueError(f"任务引用存在歧义：{task_ref}；候选：{names}；请使用完整目录名")
    if path_reference or (tasks_dir / raw).is_dir():
        raise ValueError(f"任务引用必须指向{scope_name}：{task_ref}")
    raise ValueError(f"任务不存在：{task_ref}")


def resolve_active_task_reference(task_ref: str, repo_root: Path) -> Path:
    """Resolve an existing active task reference deterministically.

    Args:
        task_ref: Exact task name, unique suffix, relative path, or absolute path.
        repo_root: Repository root path.

    Returns:
        Resolved active task directory.

    Raises:
        ValueError: The reference is empty, ambiguous, missing, or outside active tasks.
    """
    from .tasks import iter_active_tasks

    tasks_dir = get_tasks_dir(repo_root).resolve()
    try:
        records = list(iter_active_tasks(tasks_dir))
    except OSError as error:
        raise ValueError(f"无法读取活动任务目录：{tasks_dir}") from error
    return _resolve_task_reference_from_records(task_ref, repo_root, records, "活动任务目录")


def resolve_top_level_task_reference(task_ref: str, repo_root: Path) -> Path:
    """Resolve an existing top-level task, including a logical closed task.

    Args:
        task_ref: Exact task name, unique suffix, relative path, or absolute path.
        repo_root: Repository root path.

    Returns:
        Resolved top-level task directory.

    Raises:
        ValueError: The reference is empty, ambiguous, missing, or physically archived.
    """
    from .tasks import iter_top_level_tasks

    tasks_dir = get_tasks_dir(repo_root).resolve()
    try:
        records = list(iter_top_level_tasks(tasks_dir))
    except OSError as error:
        raise ValueError(f"无法读取顶层任务目录：{tasks_dir}") from error
    return _resolve_task_reference_from_records(task_ref, repo_root, records, "顶层任务目录")


def resolve_task_reference(task_ref: str, repo_root: Path) -> Path:
    """Resolve an active task reference for backward-compatible callers.

    Args:
        task_ref: Exact task name, unique suffix, relative path, or absolute path.
        repo_root: Repository root path.

    Returns:
        Resolved active task directory.

    Raises:
        ValueError: The reference is not an unambiguous active task.
    """
    return resolve_active_task_reference(task_ref, repo_root)
