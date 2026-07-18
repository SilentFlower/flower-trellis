For inferred high-confidence complex implementation intent, preserve request scope and the dirty baseline:

```bash
python3 ./.trellis/scripts/task_intent.py create --title "<task title>" --slug <name>
```

For explicit user-requested task planning or a manually maintained task, use the ordinary creator:

```bash
python3 ./.trellis/scripts/task.py create "<task title>" --slug <name>
```
