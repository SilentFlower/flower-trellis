## Active Task And Lifecycle

The user sees a "current task," but Trellis stores the active task pointer per session.

```text
.trellis/.runtime/sessions/<context-key>.json
```

`task.py start` binds the task path to the current session. For a planning task, activation first requires `trellis-task-brief` to refresh and display `brief.md`; the task-start guard rejects a missing or stale Brief. Different AI windows can point to different tasks without overwriting each other.

If the platform or shell environment has no stable session identity, `task.py start` may be unable to persist the pointer. Read the structured result and platform context instead of falling back to a shared global pointer.

`task.json.status` and the planning artifacts are authoritative. `task.json.progress` is narrow recovery evidence owned by `task_progress.py`; it must not override status, infer a workflow phase, restore a previous push mode, or resume Git orchestration.

When no active pointer exists, `trellis-continue` may surface healthy `in_progress` or `completed` progress candidates, together with necessary invalid-candidate or scan diagnostics. The user must explicitly choose a task before the session is rebound; the recovery flow must never bind a session automatically. A completed candidate points to `trellis-finish-work` and archive; rework requires an explicit `completed -> in_progress` reopen.

The normal completion boundary is:

```text
in_progress -> trellis-push final progress commit/push -> local completed
completed -> explicit trellis-finish-work -> archive
completed -> explicit reopen -> in_progress
```

Partial pushes, user `commit-only`, auto-loop internal commits, and progress-sync failures remain `in_progress`. `trellis-finish-work` archives an already completed task; it does not manufacture completion from progress text.
