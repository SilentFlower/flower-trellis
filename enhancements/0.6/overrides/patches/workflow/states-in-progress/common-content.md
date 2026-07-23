Before the first implement route, restate `<task>/brief.md`; if it is missing, read the task artifacts and suggest backfilling it instead of relying on memory.
Before routing or editing, apply the `Request Triage` Active Task Scope Guard. New implementation work outside the active task title/brief stops here until the user chooses a new task, updates this task's artifacts first, or explicitly proceeds untracked without reusing its progress.
Enter Phase 2.1/2.2 through the target-matched `trellis-route`; a user route override wins over remembered evidence.
After implementation and focused validation, return to the Phase 2.1 completion contract and resolve its Pre-Check action before ending the turn; the full hold/default policy remains owned by Phase 2.1.
After Check-All, a validated auto-loop immediately records and advances; otherwise report and stop. A later interactive next/continue runs `trellis-update-spec`, then `trellis-push` for `no-op`/`written`, or stops on `needs-review`.
Run `/trellis:finish-work` only when explicitly requested after Phase 3.4 completes.
