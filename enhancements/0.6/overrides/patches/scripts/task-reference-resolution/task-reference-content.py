

def resolve_task_reference(task_ref: str, repo_root: Path) -> Path:
    """Resolve an existing active task reference deterministically.

    Args:
        task_ref: Exact task name, unique suffix, relative path, or absolute path.
        repo_root: Repository root path.

    Returns:
        Resolved active task directory.

    Raises:
        ValueError: The reference is empty, ambiguous, missing, or outside active tasks.
    """
    raw = task_ref.strip() if isinstance(task_ref, str) else ""
    if not raw:
        raise ValueError("任务引用不能为空")

    tasks_dir = get_tasks_dir(repo_root).resolve()
    normalized = raw.replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]

    candidate = Path(raw)
    if candidate.is_absolute() or "/" in normalized or normalized.startswith(".trellis"):
        candidate = candidate if candidate.is_absolute() else repo_root / Path(normalized)
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError) as error:
            raise ValueError(f"无法解析任务引用：{task_ref}") from error
        if resolved.parent != tasks_dir or resolved.name == "archive":
            raise ValueError(f"任务引用必须指向活动任务目录：{task_ref}")
        if not resolved.is_dir():
            raise ValueError(f"任务不存在：{task_ref}")
        return resolved

    exact = tasks_dir / raw
    if exact.is_dir():
        resolved = exact.resolve()
        if resolved.parent != tasks_dir or resolved.name == "archive":
            raise ValueError(f"任务引用必须指向活动任务目录：{task_ref}")
        return resolved

    try:
        named_matches = sorted(
            path
            for path in tasks_dir.iterdir()
            if path.is_dir() and path.name != "archive" and path.name.endswith(f"-{raw}")
        )
    except OSError as error:
        raise ValueError(f"无法读取活动任务目录：{tasks_dir}") from error
    matches = []
    for path in named_matches:
        resolved = path.resolve()
        if resolved.parent != tasks_dir or resolved.name == "archive":
            raise ValueError(f"任务引用必须指向活动任务目录：{task_ref}")
        matches.append(resolved)
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = ", ".join(path.name for path in matches)
        raise ValueError(f"任务引用存在歧义：{task_ref}；候选：{names}；请使用完整目录名")
    raise ValueError(f"任务不存在：{task_ref}")
