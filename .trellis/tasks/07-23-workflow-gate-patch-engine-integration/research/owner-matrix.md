# Workflow Hub Gate Owner Matrix

| Gate | Primary policy owner | Runtime owner | Hub 最终残留 |
|---|---|---|---|
| Request Intent Routing | workflow `Request Triage` | `task_intent.py` | `trellis-start` / `no_task` state 的一句入口指向 |
| Brainstorm Gate | `trellis-brainstorm` + Phase 1.1 | `task.py start` readiness checks | 规划未收敛不得激活的一句边界 |
| Task Brief Handoff | `trellis-task-brief` + Phase 1.4 | `task.py start` brief freshness/review checks | 激活前必须完成 brief handoff 的一句边界 |
| Project Knowledge Discovery | `trellis-before-dev` | `spec_router.py` | brainstorm/Hub 只保留 owner 指针 |
| Flower Update Confirmation | SessionStart update contract + Flower CLI | update hook / `self-update` confirmation args | 阻断型更新上下文优先处理的一句边界 |
| Active Task Scope Guard | request router + active workflow state | `task_intent.py` 的 create/discard/current-task safety | 新请求不得继承无关 active task 的一句边界 |
| Routing Gate | Phase 2.1/2.2 + `trellis-route` | `route_state.py` | Phase 2 必须经 target-matched route 的一句边界 |
| Auto-Loop Return Gate | `trellis-check-all` + `trellis-auto-loop` | `auto_loop.py record/next` | auto-loop result 优先于交互停止的一句顺序 |
| Interactive Post-Check Stop Gate | `trellis-check-all` + Phase 2.2 | 当前 check result/runtime 证据（若已有） | 非 auto-loop 检查报告后停止的一句边界 |
| Code Commit Confirmation Gate | Phase 3.4 + `trellis-push` | Git safety/exact commit helper | 代码 Git 动作只由 `trellis-push` 执行的一句边界 |
| Auto-loop Commit-only Preauthorization | `trellis-auto-loop` | `auto_loop.py` + `trellis-push` internal commit-only | auto-loop 授权不得泄漏到普通 push 的一句边界 |
| Bookkeeping Auto-commit Scope | `trellis-finish-work` | `safe_commit.py` + archive/journal commands | finish-work 只处理 bookkeeping 的一句边界 |
| Task Progress Recovery | `trellis-push` + recovery entry | `task_progress.py` | progress 不决定 Git 动作的一句边界 |

## Existing Evidence

- `workflow/phase-ownership` 已 replace Active Task Routing、Phase 2.1、2.2、3.3、3.4，证明 phase owner 模式已存在。
- `task.py start` 已有 brief validator/guard Patch；`trellis-brainstorm` 和 `trellis-task-brief` 已有 planning handoff Patch。
- `trellis-route`/`route_state.py`、`auto_loop.py`、`pre_check_state.py`、`task_progress.py` 已承载确定性状态。
- `trellis-check-all` 已包含 Auto-Loop Return 与 Interactive Stop；`trellis-push` 已包含确认、exact file、commit-only 与 progress；`trellis-finish-work` 已包含 exact bookkeeping。
- 当前主要缺口是 Hub 仍保留完整重复正文、部分 owner 只覆盖结果流程而缺少入口短约束，以及缺少统一的所有权/去重回归断言。
