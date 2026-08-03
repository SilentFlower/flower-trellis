def main() -> int:
    if os.environ.get("TRELLIS_HOOKS") == "0" or os.environ.get("TRELLIS_DISABLE_HOOKS") == "1":
        return 0

    data = _load_hook_input()

    cwd_str = data.get("cwd") or os.getcwd()
    cwd = Path(cwd_str)

    root = find_trellis_root(cwd)
    if root is None:
        return 0  # not a Trellis project

    config = _read_trellis_config(root)
    if prompt_has_skip_keyword(data.get("prompt", ""), _resolve_skip_keyword(config)):
        return 0  # user opted out of the per-turn breadcrumb for this turn

    templates = load_breadcrumbs(root)
    platform = _detect_platform(data)
    task = get_active_task(root, data)
    if task is None:
        untracked = _get_untracked_work(root, data)
        if untracked is None:
            # No active task or untracked work — still emit a breadcrumb nudging
            # the AI toward intent routing when the user describes real work.
            no_task_key = resolve_breadcrumb_key("no_task", platform, config)
            breadcrumb = build_breadcrumb(
                None, "no_task", templates, breadcrumb_key=no_task_key
            )
        else:
            work_id, stage, summary = untracked
            untracked_status = "untracked" if stage == "implement" else f"untracked_{stage}"
            untracked_key = resolve_breadcrumb_key(untracked_status, platform, config)
            breadcrumb = build_breadcrumb(
                None,
                untracked_status,
                templates,
                breadcrumb_key=untracked_key,
                subject_label=f"Untracked work: {work_id} ({stage})",
                subject_summary=summary,
            )
    else:
        task_id, status, source = task
        status_key = resolve_breadcrumb_key(status, platform, config)
        source_for_breadcrumb = None if platform == "codex" else source
        breadcrumb = build_breadcrumb(
            task_id, status, templates, source_for_breadcrumb, breadcrumb_key=status_key
        )
    if platform == "codex":
        parts: list[str] = []
        if task is None and not _codex_has_trellis_session_start(root):
            parts.append(CODEX_NO_TASK_BOOTSTRAP_NOTICE)
        parts.append(_codex_mode_banner(config))
        parts.append(breadcrumb)
        breadcrumb = "\n\n".join(parts)

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
