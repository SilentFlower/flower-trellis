_ALL_PLATFORM_DISPATCH = "Sub-agent dispatch protocol applies to all platforms and all sub-agents, including native Codex `SubagentStart` context injection with child-side pull fallback, class-2 Gemini/Qoder/Copilot/Reasonix/Trae/Grok/Kimi Code, hook-backed ZCode/Snow, and `trellis-research`: every dispatch prompt starts with `Active task: <task path from task.py current>` before role-specific instructions. On Grok Build, use `spawn_subagent` with `subagent_type` set to the Trellis agent name (e.g. `trellis-implement`). On Kimi Code, dispatch the built-in `coder` / `explore` sub-agent with the matching `.kimi-code/skills/trellis-<role>/SKILL.md` instructions."
_COMMON_PLATFORM_DISPATCH = "Every sub-agent dispatch prompt, including `trellis-research`, must start with `Active task: <task path from task.py current>` before role-specific instructions. For implementation/check, enter `trellis-route` first and follow its execution-mode decision."
_PLATFORM_DISPATCH_DETAILS = {
    "codex": " Codex uses native `SubagentStart` context injection with child-side pull fallback.",
    "grok": " On Grok Build, use `spawn_subagent` with `subagent_type` set to the Trellis agent name (e.g. `trellis-implement`).",
    "kimi": " On Kimi Code, dispatch the built-in `coder` / `explore` sub-agent with the matching `.kimi-code/skills/trellis-<role>/SKILL.md` instructions.",
}
_SESSION_START_DISPATCH_PLATFORMS = {
    "claude", "codebuddy", "codex", "copilot", "cursor", "droid", "gemini",
    "grok", "kimi", "kiro", "qoder", "trae", "zcode",
}


def _platform_dispatch_summary(summary: str, platform: str | None) -> str:
    """Return dispatch guidance for the detected platform, retaining a full fallback."""
    # Missing or unknown host evidence must retain the complete contract instead of guessing.
    if platform not in _SESSION_START_DISPATCH_PLATFORMS:
        return summary
    if summary.count(_ALL_PLATFORM_DISPATCH) != 1:
        return summary
    return summary.replace(
        _ALL_PLATFORM_DISPATCH,
        _COMMON_PLATFORM_DISPATCH + _PLATFORM_DISPATCH_DETAILS.get(platform, ""),
    )


