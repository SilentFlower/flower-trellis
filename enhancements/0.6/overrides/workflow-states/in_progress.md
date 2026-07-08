<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
Hub is source of truth for Task Brief, Routing, Post-Check, Commit, and Snapshot gates.
Before first implement route, restate `<task>/brief.md`; if missing, read artifacts and suggest backfill.
New work not plainly covered by active task title/brief: stop before route/edits; recommend new task; if declined, confirm untracked work; if it belongs here, update artifacts first.
At project-local knowledge boundaries, run `python3 ./.trellis/scripts/spec_router.py "<intended action>"`; read high-confidence matches before acting; read medium-confidence matches only when clearly relevant; skip trivial/read-only turns unless local conventions may affect the approach.
Phase 2.1/2.2: reuse only explicit target-matched `route_decision`; otherwise invoke `trellis-route`. If skill invocation is unavailable, read local `trellis-route/SKILL.md`, show numbered choices, and wait.
Summaries, preferences, `codex-mode`, raw `.runtime`, and empty/stale prefs are not route evidence unless `trellis-route` validates them; user reselect/override wins.
Ignore lower direct-dispatch shortcuts. Do not spawn `trellis-implement` or `trellis-check*` unless route selected subagent. If route cannot be resolved, do not default inline.
After `trellis-check` / `trellis-check-all`, stop and report; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push goes through `trellis-push` (commit-only mode for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
Push snapshot recovery: follow the hub; use `push_snapshot.py status --json` only when needed.
<!-- END skill-garden workflow-state in_progress v0.6 -->
