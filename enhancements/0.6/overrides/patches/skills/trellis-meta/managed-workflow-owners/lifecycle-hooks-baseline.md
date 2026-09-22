## lifecycle hooks

`.trellis/config.yaml` supports:

```yaml
hooks:
  after_create:
    - "python3 .trellis/scripts/hooks/my_sync.py create"
  after_start:
    - "python3 .trellis/scripts/hooks/my_sync.py start"
  after_finish:
    - "python3 .trellis/scripts/hooks/my_sync.py finish"
  after_archive:
    - "python3 .trellis/scripts/hooks/my_sync.py archive"
```

Hook commands receive the `TASK_JSON_PATH` environment variable, pointing to the current task's `task.json`. Hook failures should usually warn, but not block the main task operation.
