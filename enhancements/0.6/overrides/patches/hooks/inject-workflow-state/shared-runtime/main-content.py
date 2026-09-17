def main() -> int:
    if os.environ.get("TRELLIS_HOOKS") == "0" or os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        return 0

    data = _load_hook_input()
    force_refresh = WORKFLOW_STATE_REFRESH_ARG in sys.argv[1:]

    cwd_str = data.get("cwd") or os.getcwd()
    cwd = Path(cwd_str)

    root = find_trellis_root(cwd)
    if root is None:
        emit_worktree_local_trellis_missing(data)
        return 0

    config = _read_trellis_config(root)
    if not force_refresh and prompt_has_skip_keyword(
        data.get("prompt", ""), _resolve_skip_keyword(config)
    ):
        return 0  # user opted out of the per-turn breadcrumb for this turn

    templates = load_breadcrumbs(root)
    platform = _detect_platform(data)
    if force_refresh:
        script_parts = set(Path(sys.argv[0]).parts)
        if ".codex" in script_parts:
            platform = "codex"
        elif ".claude" in script_parts:
            platform = "claude"
    task = get_active_task(root, data)
    subject_summary = None
    if task is None:
        untracked = _get_untracked_work(root, data)
        if untracked is None:
            # No active task or untracked work — still emit a breadcrumb nudging
            # the AI toward intent routing when the user describes real work.
            status = "no_task"
            breadcrumb_key = resolve_breadcrumb_key(status, platform, config)
            subject = "Status: no_task"
            breadcrumb = build_breadcrumb(
                None, status, templates, breadcrumb_key=breadcrumb_key
            )
        else:
            work_id, stage, subject_summary = untracked
            status = "untracked" if stage == "implement" else f"untracked_{stage}"
            breadcrumb_key = resolve_breadcrumb_key(status, platform, config)
            subject = f"Untracked work: {work_id} ({stage})"
            breadcrumb = build_breadcrumb(
                None,
                status,
                templates,
                breadcrumb_key=breadcrumb_key,
                subject_label=subject,
                subject_summary=subject_summary,
            )
    else:
        task_id, status, source = task
        breadcrumb_key = resolve_breadcrumb_key(status, platform, config)
        subject = f"Task: {task_id} ({status})"
        source_for_breadcrumb = None if platform == "codex" else source
        breadcrumb = build_breadcrumb(
            task_id, status, templates, source_for_breadcrumb, breadcrumb_key=breadcrumb_key
        )

    action = _workflow_state_action(templates, status, breadcrumb_key)
    heartbeat = _build_workflow_state_heartbeat(
        subject,
        action,
        _resolve_heartbeat_turns(config),
        subject_summary=subject_summary,
    )
    if platform == "codex":
        parts: list[str] = []
        if task is None and not _codex_has_trellis_session_start(root):
            parts.append(CODEX_NO_TASK_BOOTSTRAP_NOTICE)
        parts.append(_codex_mode_banner(config))
        parts.append(breadcrumb)
        breadcrumb = "\n\n".join(parts)

    breadcrumb = _conditional_workflow_state_context(
        root,
        data,
        platform,
        config,
        breadcrumb,
        heartbeat,
        force_refresh,
    )
    if breadcrumb is None:
        return 0

    # Kiro (CLI userPromptSubmit / IDE promptSubmit) adds a hook's stdout
    # directly to the conversation context — no JSON envelope. Emit the bare
    # breadcrumb text. Conditionally isolated: all other platforms keep the
    # hookSpecificOutput JSON path below unchanged.
    if platform == "kiro":
        print(breadcrumb)
        return 0

    # Gemini CLI 0.40.x rejects "UserPromptSubmit" — its per-turn event is
    # named "BeforeAgent". Other platforms (Claude/Cursor/Qoder/CodeBuddy/
    # Droid/Codex/Copilot) accept the original Claude-style name.
    hook_event_name = (
        "BeforeAgent" if platform == "gemini" else "UserPromptSubmit"
    )

    output = {
        "hookSpecificOutput": {
            "hookEventName": hook_event_name,
            "additionalContext": breadcrumb,
        }
    }
    print(json.dumps(output))
    return 0
