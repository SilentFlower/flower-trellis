## Local Modification Patterns

Start from the runtime section, then move to its owner:

| Goal | Durable owner route |
| --- | --- |
| Add or reorder a phase | Workflow Patch/source plus every affected owner handoff |
| Change task creation or scope policy | Request Triage, task-intent helper, and the managed workflow/state Patch |
| Change planning activation | `trellis-task-brief` and the task-start guard |
| Change implement/check execution | `trellis-route`; Check-All remains the unified check entry |
| Change automatic continuation | `trellis-auto-loop` and its runner action contract |
| Change spec/commit/archive behavior | `trellis-update-spec`, `trellis-push`, or `trellis-finish-work` respectively |
| Change recovery after interruption | `trellis-continue` and task-progress state |
| Change one platform adapter | The owning platform file/Patch while preserving the shared workflow contract |

In managed mode, update the source Patch and owner, run the synchronization and compiled-target checks, then reread the final `.trellis/workflow.md`. In native mode, a narrow local edit remains valid when no Plugin ownership claim applies.
