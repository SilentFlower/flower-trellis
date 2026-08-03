## `/trellis:continue` Recovery Ownership

`trellis-continue` owns resume decisions and uses `task_progress.py status --json` only as advisory recovery evidence. Do not maintain a second fixed route table in this reference; read the installed workflow, the owner skill, and the helper for the current version.

Stable boundaries are:

- With no active task pointer, surface each healthy candidate with its `taskStatus` and only the diagnostics needed to distinguish invalid progress or scan failures. Suggest an explicit rebind when appropriate; never bind a session automatically.
- A `planning` task returns through `trellis-brainstorm` readiness, a refreshed `brief.md`, and the task-start review gate before implementation.
- An `in_progress` task resumes from current artifacts and validated workflow evidence. Implement/check execution goes through `trellis-route`; saved progress must not infer a phase or restore Git behavior.
- A `completed` task points only to explicit `trellis-finish-work` and archive. Rework requires an explicit reopen before implementation, and material scope changes require refreshed planning artifacts and Brief approval.

When changing recovery behavior, update `trellis-continue`, `task_progress.py`, the relevant workflow owner/state, and final-output tests together. Keep detailed progress schemas, command arguments, and error matrices in the owner skill/helper rather than duplicating them here.
