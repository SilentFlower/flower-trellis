## Local Modification Patterns

Start from the runtime section, then move to its owner:

| Goal | Durable owner route |
| --- | --- |
| Add or reorder a phase | Workflow Patch/source plus every affected owner handoff |
| Change task creation or scope policy | Request Triage, task-intent helper, and the managed workflow/state Patch |
| Change untracked completion or adoption | `workflow-state:untracked`, Phase 2/3 owners, `untracked_flow.py`, and `task_intent.py adopt` |
| Change planning handoff or activation | `trellis-task-brief` and the task-start Brief guard |
| Change implement/check execution | `trellis-route`; Check-All remains the unified check entry |
| Change automatic continuation | `trellis-auto-loop` and its runner action contract |
| Change spec capture | `trellis-update-spec` |
| Change commit safety or normal completion activation | `trellis-push` and `task_progress.py` |
| Change recovery decisions or candidate discovery | `trellis-continue` and `task_progress.py` |
| Change explicit candidate rebind | `trellis-continue` owns the decision, and `task.py start` with `.trellis/scripts/common/active_task.py` owns the session pointer write |
| Change completed-task reopen | The explicit `task_progress.py reopen` path |
| Change final archive or session bookkeeping | `trellis-finish-work` and the archive implementation |
| Change one platform adapter | The owning platform file/Patch while preserving the shared workflow contract |

In managed mode, update the source Patch and owner, run the synchronization and compiled-target checks, then reread the final `.trellis/workflow.md`. In native mode, a narrow local edit remains valid when no Plugin ownership claim applies.
