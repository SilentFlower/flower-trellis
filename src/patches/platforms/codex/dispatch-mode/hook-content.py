def _resolve_codex_dispatch_mode(config: dict) -> str:
    """Normalize `codex.dispatch_mode` from .trellis/config.yaml to "auto" or "inline".

    ``auto`` keeps native subagent context injection and JSONL readiness
    available. It is not a route decision. The legacy ``sub-agent`` value is
    an alias for ``auto``; invalid explicit values retain the upstream inline
    fallback until a Flower-managed update normalizes the project.
    """
    mode = "auto"
    if isinstance(config, dict):
        codex_cfg = config.get("codex")
        if isinstance(codex_cfg, dict):
            cfg_mode = str(codex_cfg.get("dispatch_mode", mode)).strip().lower()
            if cfg_mode == "inline":
                mode = "inline"
            elif cfg_mode in ("auto", "sub-agent"):
                mode = "auto"
            else:
                mode = "inline"
    return mode


def _codex_mode_banner(config: dict) -> str:
    """Emit Codex capability context without choosing an execution route."""
    mode = _resolve_codex_dispatch_mode(config)
    if mode == "auto":
        meaning = (
            "auto: native Codex sub-agent context injection and task readiness are available. "
            "Implement/check execution mode is selected by trellis-route; this banner is not "
            "a route decision."
        )
    else:
        meaning = (
            "inline: upstream native sub-agent context readiness is disabled. Flower-managed "
            "projects normalize this capability to auto; actual execution mode is still "
            "selected by trellis-route."
        )
    return f"<codex-mode>{meaning}</codex-mode>"


def resolve_breadcrumb_key(
    status: str, platform: str | None, config: dict
) -> str:
    """Pick the Codex context variant without treating it as route evidence.

    The ordinary state carries native subagent readiness and the ``-inline``
    state is the upstream compatibility variant. Neither variant authorizes
    or filters a ``trellis-route`` inline/subagent decision.
    """
    if platform == "codex":
        mode = _resolve_codex_dispatch_mode(config)
        return f"{status}-inline" if mode == "inline" else status
    return status
