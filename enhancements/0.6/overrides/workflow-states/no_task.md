<!-- BEGIN skill-garden workflow-state no_task v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (no_task):
Creating or resuming a task is not implementation permission.
After PRD is ready and the task is started, the next implementation action is Phase 2.1 `trellis-route(implement)` unless a valid current-task implement route decision already exists.
If no active task exists, use `task_progress.py status --json` once per session; if it returns candidates, relay them and suggest rebinding before resuming. Never infer commit/push actions from progress.
At project-local knowledge boundaries, run `python3 ./.trellis/scripts/spec_router.py "<intended action>"`; read high-confidence matches before acting; read medium-confidence matches only when clearly relevant; skip trivial/read-only turns unless local conventions may affect the approach.
Do NOT call the harness built-in plan mode (`EnterPlanMode` / `ExitPlanMode`) for Trellis planning. It is not a substitute for Trellis task-creation consent, Trellis planning, or the route gate. For new, complex, or unclear work, classify the turn, ask for task-creation consent, then use `trellis-brainstorm`; `task.py create` and the default `prd.md` are not sufficient planning.
For lightweight Trellis meta edits, ask/confirm skipping Trellis tracking before edits.
<!-- END skill-garden workflow-state no_task v0.6 -->
