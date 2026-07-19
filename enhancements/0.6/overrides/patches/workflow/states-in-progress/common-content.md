Before the first implement route, restate `<task>/brief.md`; if it is missing, read the task artifacts and suggest backfilling it instead of relying on memory.
New work outside the active task title/brief must stop before routing or edits. Recommend a new task; if the work belongs here, update artifacts first; if the user declines tracking, confirm untracked execution.
Enter Phase 2.1/2.2 through the target-matched `trellis-route`; a user route override wins over remembered evidence.
After Check-All, a validated auto-loop immediately records and advances; otherwise report and stop. A later interactive next/continue runs `trellis-update-spec`, then `trellis-push` for `no-op`/`written`, or stops on `needs-review`.
Run `/trellis:finish-work` only when explicitly requested after Phase 3.4 completes.
