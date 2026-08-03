[workflow-state:untracked]
The current-session untracked work item is at `implement`. Run `python3 ./.trellis/scripts/untracked_flow.py status`, then enter Phase 2.1 through `trellis-route(target=implement)` without creating task artifacts or task-scoped route decisions.
The helper is only a workflow cursor: it does not validate file scope, Git state, focused validation, or owner evidence. After focused validation is complete, run `python3 ./.trellis/scripts/untracked_flow.py advance --stage check` and continue through the normal Phase 2.1 completion contract.
A different implementation request remains blocked by the single-active-work guard until this item is completed, explicitly abandoned, or adopted through `python3 ./.trellis/scripts/task_intent.py adopt "<title>" --slug <slug>`; adoption continues through planning artifacts, Brief review, and `task.py start`, and never authorizes immediate implementation. Unrelated read-only requests may continue without changing state.
[/workflow-state:untracked]

[workflow-state:untracked_check]
The current-session untracked work item is at `check`. Run `python3 ./.trellis/scripts/untracked_flow.py status`, then enter Phase 2.2 through `trellis-route(target=check)` and execute `trellis-check-all`.
If Check-All reports findings or a new edit is needed, run `python3 ./.trellis/scripts/untracked_flow.py advance --stage implement` before returning to implementation. On a strict pass, keep `check` while the interactive stop gate waits; only a same-turn direct Git continuation or a later explicit continuation advances to `spec`.
[/workflow-state:untracked_check]

[workflow-state:untracked_spec]
The current-session untracked work item is at `spec`. Run `python3 ./.trellis/scripts/untracked_flow.py status`, then load `trellis-update-spec`.
Keep `spec` for `needs-review`. For `no-op` or `written`, run `python3 ./.trellis/scripts/untracked_flow.py advance --stage push`. The helper records only the next owner; Update-Spec owns its evidence and validation.
[/workflow-state:untracked_spec]

[workflow-state:untracked_push]
The current-session untracked work item is ready to enter Push. Run `python3 ./.trellis/scripts/untracked_flow.py status`, require `stage=push`, and load `trellis-push`.
`stage=push` is only a route cursor: it is not a Git plan, user confirmation, or proof that Push already ran. `trellis-push` owns the exact plan, confirmation, Git safety checks, and execution. Clear with `--reason completed` only after every confirmed Git action succeeds; new edits first return the cursor to `implement`.
[/workflow-state:untracked_push]
