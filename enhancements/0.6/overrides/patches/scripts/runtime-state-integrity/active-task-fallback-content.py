def _resolve_single_session_fallback(repo_root: Path) -> ActiveTask | None:
    """Return the sole healthy session task without crossing corrupt state."""
    sessions_dir = _runtime_sessions_dir(repo_root)
    if not sessions_dir.is_dir():
        return None

    session_files = sorted(sessions_dir.glob("*.json"))
    if len(session_files) != 1:
        return None

    session_file = session_files[0]
    result = _read_json_result(session_file)
    fallback_key = session_file.stem
    if result["status"] in {"corrupt", "io_error"}:
        return ActiveTask(None, f"session-{result['status']}", fallback_key)
    context = result["data"] if isinstance(result.get("data"), dict) else {}
    task_ref = _string_value(context.get("current_task"))
    if not task_ref:
        return None
    return _active_from_ref(task_ref, repo_root, "session-fallback", fallback_key)
