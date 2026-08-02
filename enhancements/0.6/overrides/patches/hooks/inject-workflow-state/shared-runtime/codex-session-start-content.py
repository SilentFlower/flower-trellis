

def _codex_has_trellis_session_start(root: Path) -> bool:
    """Return whether the managed Codex SessionStart hook is registered."""
    session_start = root / ".codex" / "hooks" / "session-start.py"
    if not session_start.is_file():
        return False

    hooks_path = root / ".codex" / "hooks.json"
    try:
        config = json.loads(hooks_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    hooks_config = config.get("hooks")
    if not isinstance(hooks_config, dict):
        return False
    groups = hooks_config.get("SessionStart")
    if not isinstance(groups, list):
        return False
    for group in groups:
        hooks = group.get("hooks") if isinstance(group, dict) else None
        if not isinstance(hooks, list):
            continue
        for hook in hooks:
            if not isinstance(hook, dict):
                continue
            command = hook.get("command")
            if isinstance(command, str) and ".codex/hooks/session-start.py" in command:
                return True
    return False
