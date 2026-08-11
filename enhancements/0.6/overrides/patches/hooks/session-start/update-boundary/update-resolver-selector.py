def _resolve_update_hint(trellis_dir: Path, context_key: str | None) -> str | None:
    """Ask common.session_context whether a Trellis update is available.

    Throttling lives there: the first SessionStart of a session writes a marker
    under `.trellis/.runtime/`, and later ones (clear, compact) return without
    spawning `trellis --version`. The resolved `context_key` is passed through so
    the marker is scoped to the same session identity the rest of the hook uses,
    rather than session_context's environment-only fallback.

    Best-effort: a missing scripts dir, an import error, or anything raised while
    probing versions leaves the rest of the payload untouched.
    """
    scripts_dir = trellis_dir / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.session_context import get_update_hint  # type: ignore[import-not-found]

        return get_update_hint(trellis_dir.parent, context_key)
    except Exception:
        return None  # Optional reminder; keep session-start non-fatal.
