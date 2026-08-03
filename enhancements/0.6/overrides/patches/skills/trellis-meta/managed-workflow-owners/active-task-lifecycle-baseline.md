## Active Task

The user sees a "current task," but Trellis stores active task state per session.

```text
.trellis/.runtime/sessions/<context-key>.json
```

`task.py start` writes the task path into the runtime session file for the current session. `task.py current --source` shows the current task and where it came from. Different AI windows can point to different tasks without overwriting each other.

If the platform or shell environment has no stable session identity, `task.py start` may be unable to set the active task. The AI should read the error, inspect the platform hook/session environment, and not fall back to a shared global pointer.
