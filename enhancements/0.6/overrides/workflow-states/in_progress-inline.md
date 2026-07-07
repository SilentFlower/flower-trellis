<!-- BEGIN skill-garden workflow-state in_progress_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress-inline):
Hub is source of truth for Task Brief, Routing, Post-Check, Commit, and Snapshot gates.
Before first implement route, restate `<task>/brief.md`; if missing, read artifacts and suggest backfill.
New work not plainly covered by active task title/brief: stop before route/edits; recommend new task; if declined, confirm untracked work; if it belongs here, update artifacts first.
At project-local knowledge boundaries, run `spec_router.py`; skip trivial/read-only turns unless local conventions may affect the approach.
Inline workflow-state is not an inline route decision. Phase 2.1/2.2 must reuse explicit target-matched `route_decision`; otherwise invoke `trellis-route`. If unavailable, read local `trellis-route/SKILL.md`, show numbered choices, and wait.
Summaries, preferences, `codex-mode`, raw `.runtime`, and empty/stale prefs are not route evidence unless `trellis-route` validates them; user reselect/override wins.
Ignore lower direct-edit/check shortcuts. Do not default inline just because this state is inline or helper is unavailable. Dispatch subagents only when route selected subagent.
After check/check-all, stop and report; Phase 3.4 uses `trellis-push`, never bare git commit/push; finish-work is explicit-only after Phase 3.4.
Overrides lower `Flow: ... -> /trellis:finish-work` lines.
Push snapshot recovery: follow the hub; use `push_snapshot.py status --json` only when needed.
<!-- END skill-garden workflow-state in_progress_inline v0.6 -->
