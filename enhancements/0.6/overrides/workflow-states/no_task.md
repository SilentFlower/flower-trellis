<!-- BEGIN skill-garden workflow-state no_task v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (no_task):
Creating or resuming a task is not implementation permission.
After PRD is ready and the task is started, the next implementation action is Phase 2.1 `trellis-route(implement)` unless a valid current-task implement route decision already exists.
If no active task exists, use `push_snapshot.py status --json` once per session; if it returns candidates, relay them and suggest rebinding before resuming.
Before procedural or high-impact actions, run `.trellis/scripts/spec_router.py` with a short query describing the intended action and read the strongest 1-2 matched SOP/spec files before acting.
Do NOT call the harness built-in plan mode (`EnterPlanMode` / `ExitPlanMode`) for Trellis planning. It is not a substitute for Trellis task-creation consent, Trellis planning, or the route gate. For complex work, classify the turn, ask for task-creation consent, then use `trellis-brainstorm`.
If the turn is a meta edit to Trellis itself and Trellis tracking would be overkill, say so and ask to skip Trellis; never silently swap built-in plan mode in for the consent gate.
<!-- END skill-garden workflow-state no_task v0.6 -->
