[workflow-state:untracked]
One current-session untracked work item is active. Run `python3 ./.trellis/scripts/untracked_flow.py status` and continue its reported stage; do not create task artifacts or task-scoped route decisions.
At `inspect` or `implement`, enter Phase 2.1 with `trellis-route(target=implement)` and run `prepare-edit --paths <exact paths>` before every write batch. Use `record-validation` for focused evidence, then advance to `check` only when it passes.
At `check`, enter Phase 2.2 with `trellis-route(target=check)`; use `record-check` for the Check-All result and advance to `spec` only on a current valid pass.
At `spec`, run `trellis-update-spec`; use `record-spec` for `no-op`, `written`, or `needs-review`, and advance to `push` only for the first two results.
At `push`, load `trellis-push`; clear with `--reason completed` only after all confirmed Git actions succeed. New edits return through `prepare-edit`, which invalidates downstream evidence.
A different implementation request is blocked by the single-active-work guard until this item is completed, explicitly abandoned, or adopted through `task_intent.py adopt`; unrelated read-only requests may continue without changing state.
[/workflow-state:untracked]
