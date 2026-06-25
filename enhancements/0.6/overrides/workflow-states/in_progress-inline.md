<!-- BEGIN skill-garden workflow-state in_progress_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress-inline):
This state block is a breadcrumb; the top-level skill-garden hub is the source of truth for route details.
Before the first implement route, read `<task>/brief.md` if present and restate the task brief in chat. If it is missing, read the task artifacts and suggest backfilling brief; do not silently rely on memory.
Inline workflow-state is not an inline route decision. At Phase 2.1/2.2, reuse a valid current-task `route_decision` for the target when it exists; otherwise run `trellis-route(implement|check)` or ask the numbered fallback choices and wait.
A valid route decision must come from `trellis-route`, `numbered-fallback`, or `route-prefs` read by `trellis-route`; prose, compact/SessionStart summaries, `codex-mode`, empty prefs, and old single-value prefs are not enough.
Reuse the valid current-task route through later implementation, repair, recheck, and final re-check; reroute only on explicit reselect/override/use-X-this-time/clear-default or when no valid target decision exists.
Do not default to inline just because this state is inline or the helper is unavailable. Dispatch subagents only when the valid route decision selected subagent; otherwise execute inline in the main session.
After `trellis-check` / `trellis-check-all`, stop and report; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push still goes through `trellis-push` (commit-only for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress_inline v0.6 -->
