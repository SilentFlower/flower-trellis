<!-- BEGIN skill-garden workflow-state planning v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (planning):
Planning is not implementation permission.
Complete prd.md + required context first.
For sub-agent-dispatch platforms, required context includes real curated entries in both `implement.jsonl` and `check.jsonl`; the seed `_example` row alone is not ready.
Before `task.py start`, use `trellis-task-brief` to refresh `brief.md` from the latest task artifacts and display it in chat for review.
At project-local knowledge decision boundaries, run `.trellis/scripts/spec_router.py "<intended action>"`; read high-confidence matches before acting; skip pure Q&A, simple read-only inspection, opening local tools, or trivial edits unless local conventions may affect the approach.
After status becomes in_progress, next action = `trellis-route(implement)`, not direct edits.
<!-- END skill-garden workflow-state planning v0.6 -->
