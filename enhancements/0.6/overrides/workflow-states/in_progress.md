<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
This state block is a breadcrumb; the top-level skill-garden hub is the source of truth for route details.
Before the first implement route, read `<task>/brief.md` if present and restate the task brief in chat. If it is missing, read the task artifacts and suggest backfilling brief; do not silently rely on memory.
At Phase 2.1/2.2, reuse only an explicit target-matched `route_decision`; otherwise MUST load/read/use `trellis-route(implement|check)` (or its local `SKILL.md`) to resolve session runtime state/prefs, write the resolved decision, or show numbered fallback and wait.
Plain preferences, ordinary summaries, `codex-mode`, raw `.runtime` files, and empty/old prefs are not route evidence by themselves; only `trellis-route` may validate runtime route state.
User reselect/override/use-X-this-time/clear-default wins over remembered route evidence, runtime state, and prefs.
Ignore lower Active Task Routing shortcuts that dispatch implement/check directly. Do not spawn `trellis-implement` or `trellis-check*` unless the resolved route selected subagent. If route cannot be resolved, do not default to inline.
After `trellis-check` / `trellis-check-all`, stop and report; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push goes through `trellis-push` (commit-only mode for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress v0.6 -->
