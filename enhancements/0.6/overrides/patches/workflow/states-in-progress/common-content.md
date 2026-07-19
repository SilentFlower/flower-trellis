The Workflow Hub is the source of truth for Task Brief, Routing, Post-Check, Commit, and Task Progress gates.
Before the first implement route, restate `<task>/brief.md`; if it is missing, read the task artifacts and suggest backfilling it instead of relying on memory.
New work outside the active task title/brief must stop before routing or edits. Recommend a new task; if the work belongs here, update artifacts first; if the user declines tracking, confirm untracked execution.
At project-local knowledge boundaries, run `python3 ./.trellis/scripts/spec_router.py "<intended action>"` and read relevant high-confidence matches before acting.
Phase 2.1/2.2 must reuse only a valid target-matched `route_decision`; otherwise invoke `trellis-route`. User reselect/override wins.
After Check-All, validated auto-loop immediately records and advances. Otherwise report and stop. A later interactive next/continue after a pass runs `trellis-update-spec`; `no-op`/`written` loads `trellis-push` in the same turn, while `needs-review` stops.
At Phase 3.4 load `trellis-push`. Ordinary mode defaults to commit + push; commit-only requires explicit user intent or valid auto-loop preauthorization. Do not synthesize another commit plan or run bare Git commit/push for code.
Run `/trellis:finish-work` only when explicitly requested after Phase 3.4. Task progress recovery follows the Hub and never independently authorizes Git actions.
