def _resolve_codex_dispatch_mode(config: dict) -> str:
    """Normalize `codex.dispatch_mode` from .trellis/config.yaml to "auto" or "inline".

    Defaults to `auto`. The legacy `sub-agent` value is an alias for `auto`.
    Any other explicit value (including invalid ones) falls back to `inline`
    without per-turn warnings. Shared by `_codex_mode_banner` (the per-turn
    banner) and `resolve_breadcrumb_key` (the breadcrumb tag key) so the two
    stay in lockstep.
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
    """Emit a `<codex-mode>` banner for the additionalContext payload.

    Reads `codex.dispatch_mode` from .trellis/config.yaml; defaults to
    `auto`, which dispatches Trellis sub-agents using native Codex context
    injection with a child-side fallback. This does not rely on inherited
    parent transcripts: `fork_turns` remains caller-controlled, and
    fresh-history sub-agents still receive their explicit delegated task and
    inherited session configuration. `inline` is an explicit opt-out; the
    legacy `sub-agent` value is an alias for `auto`. Invalid explicit values
    fall back to `inline` without per-turn warnings. The banner makes the
    active mode explicit to Codex AI per turn, complementing the workflow-state
    body which is per-status. Mode tells AI which dispatch protocol to follow;
    workflow-state tells AI what step it's at.
    """
    mode = _resolve_codex_dispatch_mode(config)
    if mode == "auto":
        meaning = (
            "auto: implement/check work defaults to Trellis sub-agents; native Codex "
            "context injection is preferred and child-side loading is the fallback. "
            "The main session still coordinates, clarifies, updates specs, commits, and finishes."
        )
    else:
        meaning = (
            "inline: the main session implements/checks directly; "
            "do not dispatch implement/check sub-agents."
        )
    return f"<codex-mode>{meaning}</codex-mode>"


def resolve_breadcrumb_key(
    status: str, platform: str | None, config: dict
) -> str:
    """Pick the breadcrumb tag key based on Codex dispatch_mode.

    Codex defaults to ``auto`` and therefore uses the ordinary ``<status>``
    breadcrumb for native SubagentStart dispatch with child-side fallback;
    it does not depend on an inherited parent transcript. ``inline`` selects
    the parallel ``<status>-inline`` tag; ``sub-agent`` remains an alias for
    ``auto``. Invalid explicit values fall back to inline without per-turn
    warnings.

    Non-codex platforms return the plain status unchanged.
    """
    if platform == "codex":
        mode = _resolve_codex_dispatch_mode(config)
        return f"{status}-inline" if mode == "inline" else status
    return status
