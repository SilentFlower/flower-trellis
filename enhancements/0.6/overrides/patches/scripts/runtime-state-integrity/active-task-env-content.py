def _lookup_env_context_key(platform_name: str | None) -> str | None:
    """Resolve a context key from platform-provided environment variables.

    Hooks pass `TRELLIS_CONTEXT_ID` to subprocesses they launch, but an AI-run
    shell command can only see session identity if the host platform exports it
    in the command environment. These names are best-effort adapters; if none
    are present, there is no session-scoped active task.
    """
    env_platform_name = _env_platform_name(platform_name)
    if env_platform_name is None:
        candidates = {
            _CONTEXT_KEY_PLATFORM_ALIASES.get(name, name)
            for table in (_ENV_SESSION_KEYS, _ENV_CONVERSATION_KEYS, _ENV_TRANSCRIPT_KEYS)
            for name, keys in table
            if any(_string_value(os.environ.get(key)) for key in keys)
        }
        if len(candidates) > 1:
            # Inherited variables may describe an outer tool; use the nearest host.
            try:
                from flower_session_host import select_platform
            except ImportError as error:
                raise ValueError("Multiple platform identities require an explicit platform or TRELLIS_CONTEXT_ID") from error
            env_platform_name = select_platform(candidates)

    for name, keys in _iter_env_keys(_ENV_SESSION_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "session", value)

    for name, keys in _iter_env_keys(_ENV_CONVERSATION_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "conversation", value)

    for name, keys in _iter_env_keys(_ENV_TRANSCRIPT_KEYS, env_platform_name):
        for key in keys:
            value = _string_value(os.environ.get(key))
            if value:
                return _context_key(name, "transcript", value)

    return None

