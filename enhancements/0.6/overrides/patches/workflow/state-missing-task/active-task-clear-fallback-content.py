def clear_active_task(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ActiveTask:
    """Clear the active task for the current or sole fallback session.

    Args:
        repo_root: Repository root.
        platform_input: Platform hook input.
        platform: Explicit platform name.

    Returns:
        The resolved task before cleanup, or an empty task when no session is safe to select.
    """
    context_key = resolve_context_key(platform_input, platform)
    previous = resolve_active_task(repo_root, platform_input, platform)

    # Fallback resolution is safe only when the runtime contains exactly one session file.
    if previous.source_type == "session-fallback" and previous.context_key:
        context_key = previous.context_key
    if not context_key:
        return ActiveTask(None, "none")

    context_path = _context_path(repo_root, context_key)
    if context_path.is_file():
        _remove_file(context_path)
    return previous
