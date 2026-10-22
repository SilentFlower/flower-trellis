## Skill Routing

Do not choose implementation or checking behavior from a static platform-capability split. Read the current Workflow Owner Index and let `trellis-route` resolve inline versus subagent execution.

Stable owner categories are:

| Gate or behavior | Owner to load |
| --- | --- |
| Request intent and project knowledge discovery | Request Triage, `trellis-start`, and the referenced router helper |
| Active task scope safety | Request Triage and the active-task scope guard |
| Untracked work completion | `workflow-state:untracked*`, Phase 2/3 owners, and `untracked_flow.py` |
| Untracked task adoption | `workflow-state:untracked*`, `trellis-brainstorm`, and `task_intent.py adopt` |
| Planning handoff and activation | `trellis-task-brief` and the task-start Brief guard |
| Implement/check execution mode | `trellis-route` |
| Unified quality verification | `trellis-check-all` |
| Automatic task loop and return gate | `trellis-auto-loop` plus the matching Check-All result |
| Executable knowledge capture | `trellis-update-spec` |
| Commit/push safety and completion activation | `trellis-push` and `task_progress.py` |
| Deterministic task Close | `task_progress.py`, `task_lifecycle.py`, and the invoking `trellis-push` / `trellis-auto-loop` path |
| Delayed physical GC | SessionStart bridge and `task_lifecycle.py session-start` |
| Cross-session task progress discovery and recovery | `trellis-continue` owns the recovery decision, `task_progress.py` owns candidate evidence and completed-task reopen, and `task.py start` with `.trellis/scripts/common/active_task.py` owns explicit session binding |

This reference names owners; it does not copy their command schemas, interaction templates, state formats, or error matrices. Read `.trellis/workflow.md`, the local owner skill/helper, available `overrides/bundles/`, and `.flower/state.json` for the installed version. Do not maintain a fixed Skill-Garden skill count or exhaustive capability list here.

### Runtime Owner Details

The startup Workflow Owner Index names policy owners. Consult this runtime map when maintaining or debugging the workflow.

| Gate / Guard | Runtime owner |
| --- | --- |
| Request Intent Routing | `task_intent.py` |
| Harness Plan Mode Ban | injected state text (no runtime hook) |
| Brainstorm Gate | `task.py start` readiness |
| Task Brief Handoff | `task.py start` brief guard |
| Project Knowledge Discovery | `spec_router.py` |
| Flower Update Confirmation | update hook / `self-update` arguments |
| Active Task Scope Guard | `task_intent.py` scope safety |
| Untracked Work Completion Chain | `untracked_flow.py` |
| Untracked Task Adoption | `task_intent.py adopt` |
| Routing Gate | `route_state.py` |
| Auto-Loop Return Gate | `auto_loop.py record/next` |
| Interactive Post-Check Stop Gate | current Check-All evidence |
| Code Commit Confirmation Gate | exact Git safety checks |
| Auto-loop Commit-only Preauthorization | `auto_loop.py` + `trellis-push` internal commit-only |
| Deterministic Task Close | `task_progress.py` + `task_lifecycle.py` |
| Deferred Physical GC | `task_lifecycle.py session-start` |
| Task Progress Recovery | `task_progress.py` |

The Hub must not duplicate owner procedures, helper schemas, interaction templates, error matrices, or Git path rules.
