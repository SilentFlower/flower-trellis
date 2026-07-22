#### 1.4 Activate task `[required · once]`

Before changing task status, load `trellis-task-brief`, refresh `<task>/brief.md`, display the full brief in chat, then stop the current turn and wait for planning review confirmation. Earlier implementation intent is not confirmation.

Lightweight tasks need `prd.md`; complex tasks also need `design.md` and `implement.md`. Sub-agent routes require real entries in both JSONL manifests.

Only after the user confirms the displayed brief in a later message, run:

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

If start rejects a missing or stale brief, repeat the brief handoff. Follow any session-identity hint; after success, enter `trellis-route(target=implement)`.
