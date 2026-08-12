## Active Task And Lifecycle

The user sees a "current task," but Trellis stores the active task pointer per session.

```text
.trellis/.runtime/sessions/<context-key>.json
```

`task.py start` binds the task path to the current session. For a planning task, activation first requires `trellis-task-brief` to refresh and display `brief.md`; the task-start guard rejects a missing or stale Brief. Different AI windows can point to different tasks without overwriting each other.

If the platform or shell environment has no stable session identity, `task.py start` may be unable to persist the pointer. Read the structured result and platform context instead of falling back to a shared global pointer.

`task.json.status` and the planning artifacts are authoritative. `task.json.progress` is narrow recovery evidence owned by `task_progress.py`; it must not override status, infer a workflow phase, restore a previous push mode, or resume Git orchestration.

When no active pointer exists, `trellis-continue` may surface healthy `in_progress` or `completed` progress candidates, together with necessary invalid-candidate or scan diagnostics. The user must explicitly choose a task before the session is rebound; the recovery flow must never bind a session automatically. After explicit rebind, a completed candidate enters the `trellis-push` completed-task preflight, which owns publication recovery and the handoff to explicit `trellis-finish-work`. Rework requires an explicit `completed -> in_progress` reopen.

The normal completion boundary is:

```text
in_progress -> business push -> atomic final progress + completed -> task-record commit/push
completed -> trellis-push completed-task preflight -> recovery or explicit trellis-finish-work -> archive
completed -> explicit reopen -> in_progress
```

Partial pushes, user `commit-only`, and normal helper failures remain `in_progress`. Auto-loop internal commits keep their separate local completion and `pending_archive` contract. `trellis-finish-work` independently enforces archive eligibility for direct invocation, but does not reproduce Push recovery classification or manufacture completion from progress text.
