## Common Commands

```bash
python3 ./.trellis/scripts/task.py create "<title>" --slug <slug>
python3 ./.trellis/scripts/task.py start <task>
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py add-context <task> implement <file> <reason>
python3 ./.trellis/scripts/task.py validate <task>
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive <task>
```

When modifying the task system, the AI should prefer script commands to maintain structure. Edit JSON/Markdown directly only when scripts do not cover the need.
