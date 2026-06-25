<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
Phase 2.1: run `trellis-route(implement)` first.
Phase 2.2: run `trellis-route(check)` before check/check-all.
On check failure or a user-reported issue in the just-checked work, reuse the latest implement/check route; reroute only on explicit reselect/override or a new independent check stage.
Do not spawn `trellis-implement` or `trellis-check*` unless route selected subagent, including a reused same-cycle subagent route.
If the helper is unavailable, ask numbered route choices and wait; do not default to inline check.
After `trellis-check` / `trellis-check-all`, stop and report; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push goes through `trellis-push` (commit-only mode for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress v0.6 -->
