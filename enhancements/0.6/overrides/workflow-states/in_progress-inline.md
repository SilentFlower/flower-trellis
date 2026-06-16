<!-- BEGIN skill-garden workflow-state in_progress_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress-inline):
Inline mode does not skip `trellis-route`: before implementation, route `implement` first; before checking, route `check` first. Only after the route selects inline should the main session run `trellis-before-dev`, edit code, or run `trellis-check` / `trellis-check-all`.
After `trellis-check` / `trellis-check-all`, stop and report; do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push still goes through `trellis-push` (commit-only for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress_inline v0.6 -->
