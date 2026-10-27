### Skill-Garden Workflow Owner Index

Follow each gate's policy owner; load its procedures and runtime details on demand.

| Gate / Guard | Primary policy owner |
| --- | --- |
| Request Intent Routing | `Request Triage` + `trellis-start` |
| Harness Plan Mode Ban | `workflow-state:no_task` + `workflow-state:planning*` + `workflow-state:in_progress*` |
| Brainstorm Gate | Phase 1.1 + `trellis-brainstorm` |
| Task Brief Handoff | Phase 1.4 + `trellis-task-brief` |
| Project Knowledge Discovery | `Request Triage` |
| Flower Update Confirmation | SessionStart update context + Flower CLI |
| Active Task Scope Guard | `Request Triage` |
| Untracked Work Completion Chain | `workflow-state:untracked*` + Phase 2/3 owners |
| Untracked Task Adoption | `workflow-state:untracked*` + `trellis-brainstorm` |
| Routing Gate | Phase 2 + `trellis-route` |
| Auto-Loop Return Gate | `trellis-check-all` + `trellis-auto-loop` |
| Interactive Post-Check Stop Gate | Phase 2.2 + `trellis-check-all` |
| Code Commit Confirmation Gate | Phase 3.4 + `trellis-push` |
| Auto-loop Commit-only Preauthorization | `trellis-auto-loop` |
| Deterministic Task Close | `trellis-push` + `trellis-auto-loop` |
| Deferred Physical GC | SessionStart |
| Task Progress Recovery | `trellis-continue` |

Cross-stage ordering:

1. Request intent, active-task scope, and any current untracked work are resolved before task creation, task routing, or file edits.
2. A validated auto-loop result returns through matching `record` + `next` before the interactive post-check stop applies.
3. Interactive completion proceeds Check-All -> `trellis-update-spec` -> `trellis-push` for task/tracked work. Eligible quick direct edits use successful focused validation -> `trellis-update-spec` -> `trellis-push` in the same turn through `workflow-state:no_task`; explicit user stops remain effective. Successful task delivery writes completion and deterministic Close in one lifecycle update.
