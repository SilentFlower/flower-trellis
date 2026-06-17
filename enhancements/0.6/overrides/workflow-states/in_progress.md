<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
At Phase 2.1, invoke `trellis-route(implement)` first.
At Phase 2.2, run the implement-loop quality check directly; do not upgrade this step into `trellis-route(check)`.
At Phase 3.1 final verification, invoke `trellis-route(check)` first for check/check-all routing.
Do not spawn `trellis-implement` at Phase 2.1 or final `trellis-check` / `trellis-check-all` at Phase 3.1 unless `trellis-route` just selected subagent mode; Phase 2.2 implement-loop checks follow the normal quality-check step without standalone route.
If routing helper is unavailable at the Phase 2.1 or Phase 3.1 route boundary, ask the same numbered route choices in normal chat and wait for the user's selection.
After `trellis-check` / `trellis-check-all`, stop and report; do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push goes through `trellis-push` (commit-only mode for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress v0.6 -->
