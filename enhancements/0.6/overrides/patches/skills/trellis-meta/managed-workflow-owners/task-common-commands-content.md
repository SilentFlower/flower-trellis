## Common Commands

```bash
python3 ./.trellis/scripts/task.py create "<title>" --slug <slug>
python3 ./.trellis/scripts/task.py start <task>
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py add-context <task> implement <file> <reason>
python3 ./.trellis/scripts/task.py validate <task>
python3 ./.trellis/scripts/task.py close <task> --json
python3 ./.trellis/scripts/task.py list [--closed|--all] [--json]
python3 ./.trellis/scripts/task.py gc --closed --before 3d [--dry-run] [--json]
python3 ./.trellis/scripts/task.py restore <task> [--dry-run] [--json]
```

Close changes semantic lifecycle state immediately. Physical GC only moves already-closed task directories and is normally invoked by SessionStart; run it manually only for diagnosis or explicit maintenance. Prefer script commands to direct JSON edits.
