#### 2.1 Implement `[required · repeatable]`

Implementation requires an active `in_progress` task and reviewed planning artifacts. Run `trellis-route(target=implement)` before editing or dispatching.

Follow the validated route result:

- `inline`: load `trellis-before-dev`, read the active task artifacts and referenced context, then implement and run focused verification.
- `subagent`: dispatch the selected implement agent with `Active task: <task path>` as the first prompt line; the agent implements directly and must not recursively dispatch implement/check agents.

Route preference recovery, fallback choices, and runtime evidence belong to `trellis-route`; do not reproduce them here.
