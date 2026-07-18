If no task exists yet, choose the creator from the authorization source.

For inferred high-confidence complex implementation intent, create an auto-routed planning task:

```bash
python3 ./.trellis/scripts/task_intent.py create --title "<short task title>" --slug <slug>
```

For explicit user-requested task planning or a manually maintained task, use:

```bash
python3 ./.trellis/scripts/task.py create "<short task title>" --slug <slug>
```

Use a concise title from the user's request and a slug without a date prefix. Both paths create the default `prd.md`; update it with the current understanding before asking follow-up questions.
