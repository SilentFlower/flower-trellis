### Active Task Routing

When a user request matches one of these intents inside an active task, enter the owning workflow capability before loading step detail:

- Planning or unclear requirements -> `trellis-brainstorm`.
- `in_progress` implementation -> `trellis-route(target=implement)`.
- `in_progress` check/check-all -> `trellis-route(target=check)`.
- Repeated debugging -> `trellis-break-loop`; spec updates -> `trellis-update-spec`.

The route result owns the inline/subagent choice. Do not infer execution mode from platform name or dispatch directly from this table.
