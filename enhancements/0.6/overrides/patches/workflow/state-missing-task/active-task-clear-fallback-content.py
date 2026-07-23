def clear_active_task(
    repo_root: Path,
    platform_input: dict[str, Any] | None = None,
    platform: str | None = None,
) -> ClearActiveTaskResult:
    """Clear the active task for the current or sole fallback session.

    Args:
        repo_root: Repository root.
        platform_input: Platform hook input.
        platform: Explicit platform name.

    Returns:
        Structured cleanup result with the previously resolved task and deletion status.
    """
    context_key = resolve_context_key(platform_input, platform)
    previous = resolve_active_task(repo_root, platform_input, platform)

    # Fallback resolution is safe only when the runtime contains exactly one session file.
    if previous.source_type in {"session-fallback", "session-corrupt", "session-io_error"} and previous.context_key:
        context_key = previous.context_key
    if not context_key:
        return ClearActiveTaskResult(ActiveTask(None, "none"), True)

    context_path = _context_path(repo_root, context_key)
    context_result = _read_json_result(context_path)
    if context_result["status"] in {"corrupt", "io_error"}:
        return ClearActiveTaskResult(
            previous,
            False,
            f"session-runtime-{context_result['status']}:{context_result.get('error') or ''}",
        )
    if context_path.is_file():
        if not _remove_file(context_path):
            return ClearActiveTaskResult(previous, False, "session-file-delete-failed")
    return ClearActiveTaskResult(previous, True)
