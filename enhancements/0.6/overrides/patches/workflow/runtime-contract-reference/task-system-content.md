### Task System

Every task has a directory under `.trellis/tasks/{MM-DD-name}/`. `task.json.status` records work state (`planning`, `in_progress`, `completed`); `task.json.closeout` independently records deterministic Close (`pending`, `blocked`, `closed`). A closed task leaves every active view immediately, even before its directory moves.

```bash
python3 ./.trellis/scripts/task.py create "<title>" [--slug <name>] [--parent <dir>]
python3 ./.trellis/scripts/task.py start <name>
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py finish                # only clear this session pointer
python3 ./.trellis/scripts/task.py close <name> --json
python3 ./.trellis/scripts/task.py close <name> --retire-reason "<explicit user termination reason>" --json
python3 ./.trellis/scripts/task.py list [--closed|--all] [--mine] [--json]
python3 ./.trellis/scripts/task.py gc --closed --before 3d [--dry-run] [--json]
python3 ./.trellis/scripts/task.py restore <name> [--dry-run] [--json]
python3 ./.trellis/scripts/task.py add-context <name> <action> <file> <reason>
python3 ./.trellis/scripts/task.py list-context <name> [action]
python3 ./.trellis/scripts/task.py validate <name>
python3 ./.trellis/scripts/task.py add-subtask <parent> <child>
python3 ./.trellis/scripts/task.py remove-subtask <parent> <child>
python3 ./.trellis/scripts/task.py create-pr [name] [--dry-run]
```

`task.py start` binds the task to the current AI session and moves planning work to `in_progress`. Successful normal delivery and successful auto-loop commit-only both write completion plus Close through their owning deterministic helper; Close does not call a model. Physical GC runs best-effort from SessionStart on startup/resume for tasks closed at least three days, commits only the exact moved paths, never pushes, and can be reversed with `restore`.

For completed work that the user explicitly ends, `close --retire-reason` records the reason and a non-success outcome in `meta.retirement`. Rejected decisions and unresolved change IDs remain in the audit trail; the task may close without turning them into accepted reviews. Other Close requirements still apply.
