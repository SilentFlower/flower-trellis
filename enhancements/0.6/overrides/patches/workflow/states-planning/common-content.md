Planning is not implementation permission. Load `trellis-brainstorm` and stay in planning while requirements remain unclear.
A created task or default `prd.md` is not enough to start implementation. Lightweight tasks may remain PRD-only; complex tasks require `prd.md`, `design.md`, and `implement.md`.
If the latest current-request switch says no task/direct edit, call `task_intent.py discard --task <current-task>` only for a task auto-created by intent routing. Continue only on `status=discarded`; keep manual or historical tasks unchanged.
Before `task.py start`, refresh and display `brief.md` through `trellis-task-brief`, then wait for planning review confirmation.
After status becomes `in_progress`, enter Phase 2 through `trellis-route(target=implement)` instead of editing or dispatching directly.
