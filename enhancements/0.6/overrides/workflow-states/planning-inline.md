<!-- BEGIN skill-garden workflow-state planning_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (planning-inline):
Planning is not implementation permission.
Complete prd.md + required context first.
If the active workflow later routes to sub-agent execution, required context includes real curated entries in both `implement.jsonl` and `check.jsonl`; the seed `_example` row alone is not ready.
Before `task.py start`, use `trellis-task-brief` to refresh `brief.md` from the latest task artifacts and display it in chat for review.
At project-local knowledge boundaries, run `spec_router.py`; skip trivial/read-only turns unless local conventions may affect the approach.
After status becomes in_progress, next action = `trellis-route(implement)`, not direct edits.
<!-- END skill-garden workflow-state planning_inline v0.6 -->
