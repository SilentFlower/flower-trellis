def find_trellis_root(start: Path) -> Optional[Path]:
    """Walk up from start without crossing into another Git worktree."""
    cur = start.resolve()
    while cur != cur.parent:
        if (cur / ".trellis").is_dir():
            return cur
        if (cur / ".git").exists() or (cur / ".git").is_symlink():
            return None
        cur = cur.parent
    return None


def emit_worktree_local_trellis_missing(data: dict) -> None:
    """Emit a stable bootstrap diagnostic without loading another branch."""
    message = (
        "<worktree-local-trellis-missing>\n"
        "The current Git worktree has no local .trellis directory. "
        "Run `flower-trellis worktree status --target <worktree>` from an external shell.\n"
        "</worktree-local-trellis-missing>"
    )
    platform = _detect_platform(data)
    if platform == "kiro":
        print(message)
        return
    hook_event_name = "BeforeAgent" if platform == "gemini" else "UserPromptSubmit"
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": hook_event_name,
            "additionalContext": message,
        }
    }))
