<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
Hub is source of truth for Task Brief, Routing, Post-Check, Commit, and Task Progress gates.
Before first implement route, restate `<task>/brief.md`; if missing, read artifacts and suggest backfill.
New work not plainly covered by active task title/brief: stop before route/edits; recommend new task; if declined, confirm untracked work; if it belongs here, update artifacts first.
At project-local knowledge boundaries, run `python3 ./.trellis/scripts/spec_router.py "<intended action>"`; read high-confidence matches before acting; read medium-confidence matches only when clearly relevant; skip trivial/read-only turns unless local conventions may affect the approach.
Phase 2.1/2.2: reuse only explicit target-matched `route_decision`; otherwise invoke `trellis-route`. If skill invocation is unavailable, read local `trellis-route/SKILL.md`, show numbered choices, and wait.
Summaries, preferences, `codex-mode`, raw `.runtime`, and empty/stale prefs are not route evidence unless `trellis-route` validates them; user reselect/override wins.
Ignore lower direct-dispatch shortcuts. Do not spawn `trellis-implement` or `trellis-check*` unless route selected subagent. If route cannot be resolved, do not default inline.
After Check-All, validated auto-loop must immediately `record + next`; otherwise stop and report only check results, validations, residual risks, conclusion, and next steps. Do not draft commit messages/files or ask for commit confirmation. Point interactive users to Phase 3.3 then Phase 3.4 `trellis-push`; run `/trellis:finish-work` only when explicitly requested after Phase 3.4.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, load `trellis-push`; ordinary mode defaults to commit + push, and commit-only requires explicit user intent or valid auto-loop preauthorization. Never synthesize a substitute commit plan or run bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
This guard fully disables the lower Phase 3.4 `Proposed commits` / local-only / no-push walkthrough; do not reuse any part of it.
Task progress recovery: follow the hub; use `task_progress.py status --json` only when needed, and never infer commit/push actions from progress.
<!-- END skill-garden workflow-state in_progress v0.6 -->
