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
| Completed-task archive and session bookkeeping | `trellis-finish-work` and the archive implementation |
| Cross-session task progress discovery and recovery | `trellis-continue` owns the recovery decision, `task_progress.py` owns candidate evidence and completed-task reopen, and `task.py start` with `.trellis/scripts/common/active_task.py` owns explicit session binding |

This reference names owners; it does not copy their command schemas, interaction templates, state formats, or error matrices. Read `.trellis/workflow.md`, the local owner skill/helper, available `overrides/bundles/`, and `.flower/state.json` for the installed version. Do not maintain a fixed Skill-Garden skill count or exhaustive capability list here.
