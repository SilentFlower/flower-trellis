<!-- BEGIN skill-garden workflow-state planning_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (planning-inline):
Planning is not implementation permission.
`trellis-brainstorm` is the default next action while requirements are still unclear.
A created task or existing `prd.md` is not enough to start implementation.
If the latest current-request switch says no task/direct edit, call `task_intent.py discard --task <current-task>` only for a task auto-created by intent routing; leave that task only on `status=discarded`. Keep manual or historical tasks unchanged and route the current request as untracked under the Active Task Scope Guard.
Complete prd.md + required context first.
If the active workflow later routes to sub-agent execution, required context includes real curated entries in both `implement.jsonl` and `check.jsonl`; the seed `_example` row alone is not ready.
Before `task.py start`, use `trellis-task-brief` to refresh `brief.md` from the latest task artifacts and display it in chat for review.
At project-local knowledge boundaries, run `python3 ./.trellis/scripts/spec_router.py "<intended action>"`; read high-confidence matches before acting; read medium-confidence matches only when clearly relevant; skip trivial/read-only turns unless local conventions may affect the approach.
After status becomes in_progress, next action = `trellis-route(implement)`, not direct edits.
<!-- END skill-garden workflow-state planning_inline v0.6 -->
