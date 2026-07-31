        lines.append(f"Current task: {_repo_relative(repo_root, task_dir)}; status={status}.")
    else:
        lines.append("Current task: none.")

    try:
        from untracked_flow import session_start_hint as untracked_start_hint  # type: ignore[import-not-found]

        untracked_hint = untracked_start_hint(
            repo_root,
            hook_input,
            platform="codex",
        )
    except Exception:
        untracked_hint = None
    if untracked_hint:
        lines.append(untracked_hint)

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
