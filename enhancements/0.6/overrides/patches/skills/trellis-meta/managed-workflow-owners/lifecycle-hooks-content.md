## Lifecycle Hooks

`.trellis/config.yaml` supports `after_create`, `after_start`, `after_finish`, and `after_close`. `after_close` runs best-effort only after the closed state is persisted; it must not own physical GC or decide whether Close is allowed.

```yaml
hooks:
  after_close:
    - "python3 .trellis/scripts/hooks/my_sync.py close"
```

Hook commands receive `TASK_JSON_PATH` for the current task metadata. A hook failure is diagnostic and does not roll back an already-persisted Close.
