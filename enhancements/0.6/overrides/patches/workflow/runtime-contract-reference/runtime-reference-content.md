For the workflow state machine's runtime contract, the authoritative runtime inputs are the installed per-turn hook parser and the `[workflow-state:*]` tags in this file. This Flower variant uses fixed pseudo-status tag names `no_task`, `untracked`, `untracked_check`, `untracked_spec`, `untracked_push`, and `missing_task`; hook diagnostic source types such as `session` or `session-fallback` must not become workflow-state tag names.

- Installed `<platform>/hooks/inject-workflow-state.py` copies — parse this workflow and emit the current breadcrumb for platforms with a per-turn hook.
- `.trellis/spec/` project specs, when present — project-local runtime contract notes and invariants.
