    if not resolve_context_key():
        original, status_changed, status_ok = _prepare_start_status(task_json_path)
        if not status_ok:
            return 1
        print(colored(
            "ℹ Session identity not available; active-task pointer not persisted "
            "this session (degraded mode). AI continues based on conversation context.",
            Colors.YELLOW,
        ))
        print(colored(
            "Hint: run inside an AI IDE/session that exposes session identity, "
            "or set TRELLIS_CONTEXT_ID before running task.py start.",
            Colors.YELLOW,
        ))
        if status_changed:
            print(colored("✓ Status: planning → in_progress (degraded)", Colors.GREEN))
        if task_json_path.is_file():
            run_task_hooks("after_start", task_json_path, repo_root)
        return 0
