<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
At Phase 2.1/2.2/3.1, invoke `trellis-route(implement|check)` first, including every check / check-all path.
Do not spawn `trellis-implement`, `trellis-check`, or `trellis-check-all` directly unless `trellis-route` just selected subagent mode.
If routing helper is unavailable, ask the same numbered route choices in normal chat and wait for the user's selection.
After `trellis-check` / `trellis-check-all`, stop and report; do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push goes through `trellis-push` (commit-only mode for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress v0.6 -->
