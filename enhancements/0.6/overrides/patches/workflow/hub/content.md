### Skill-Garden Workflow Owner Index

> Lightweight owner map for cross-stage workflow behavior. Source: github.com/SilentFlower/skill-garden.

Complete contracts live in the owning phase, workflow state, skill, hook, or helper. This index only records ownership and ordering that must remain visible across stages.

| Gate / Guard | Primary policy owner | Runtime owner |
| --- | --- | --- |
| Request Intent Routing | `Request Triage` + `trellis-start` | `task_intent.py` |
| Brainstorm Gate | Phase 1.1 + `trellis-brainstorm` | `task.py start` readiness |
| Task Brief Handoff | Phase 1.4 + `trellis-task-brief` | `task.py start` brief guard |
| Project Knowledge Discovery | `Request Triage` | `spec_router.py` |
| Flower Update Confirmation | SessionStart update context + Flower CLI | update hook / `self-update` arguments |
| Active Task Scope Guard | `Request Triage` | `task_intent.py` scope safety |
| Routing Gate | Phase 2 + `trellis-route` | `route_state.py` |
| Auto-Loop Return Gate | `trellis-check-all` + `trellis-auto-loop` | `auto_loop.py record/next` |
| Interactive Post-Check Stop Gate | Phase 2.2 + `trellis-check-all` | current Check-All evidence |
| Code Commit Confirmation Gate | Phase 3.4 + `trellis-push` | exact Git safety checks |
| Auto-loop Commit-only Preauthorization | `trellis-auto-loop` | `auto_loop.py` + `trellis-push` internal commit-only |
| Bookkeeping Auto-commit Scope | `trellis-finish-work` | `safe_commit.py` + archive/journal commands |
| Task Progress Recovery | `trellis-continue` | `task_progress.py` |

Cross-stage ordering:

1. A blocking `<flower-update>` confirmation is handled before ordinary request routing; a completed update returns through `trellis-push`.
2. Request intent and active-task scope are resolved before task creation, task routing, or file edits.
3. A validated auto-loop result returns through matching `record` + `next` before the interactive post-check stop applies.
4. Interactive completion proceeds Check-All -> `trellis-update-spec` -> `trellis-push`; `trellis-finish-work` runs only after Phase 3.4 and only when explicitly requested.

Mechanical rule: follow the owner named above. The Hub must not duplicate owner procedures, helper schemas, interaction templates, error matrices, or Git path rules.
