        lines.append(f"Current task: {_repo_relative(repo_root, task_dir)}; status={status}.")
    else:
        lines.append("Current task: none.")

    try:
        from pre_check_state import session_start_hint  # type: ignore[import-not-found]

        pre_check_hint = session_start_hint(
            repo_root,
            hook_input,
            platform="codex",
            active=active,
        )
    except Exception:
        pre_check_hint = None
    if pre_check_hint:
        lines.append(pre_check_hint)
