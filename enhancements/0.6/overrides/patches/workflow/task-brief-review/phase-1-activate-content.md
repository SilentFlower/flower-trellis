#### 1.4 Activate task `[required · once]`

Before changing task status, load `trellis-task-brief`, refresh `<task>/brief.md`, and display the full brief in chat. Unless `trellis-task-brief` validates an explicit preauthorization for the current final Brief, stop the current turn and wait for planning review confirmation. Ordinary implementation or task-creation intent is not confirmation.

Lightweight tasks need `prd.md`; complex tasks also need `design.md` and `implement.md`. Sub-agent routes require real entries in both JSONL manifests.

After a later confirmation, or in the same turn when that explicit preauthorization remains valid, run:

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

If start rejects a missing or stale brief, repeat the brief handoff. Follow any session-identity hint; after success, enter `trellis-route(target=implement)`.
