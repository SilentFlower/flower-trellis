    original, status_changed, status_ok = _prepare_start_status(task_json_path)
    if not status_ok:
        return 1

    active = set_active_task(task_dir, repo_root)
    if not active:
        restored = _restore_start_status(task_json_path, original) if status_changed else True
        print(colored("Error: Failed to set current task", Colors.RED))
        if not restored:
            print(colored(
                "Error: Task status rollback also failed; inspect task.json before retrying.",
                Colors.RED,
            ))
        return 1

    print(colored(f"✓ Current task set to: {task_dir}", Colors.GREEN))
    print(f"Source: {active.source}")
    if status_changed:
        print(colored("✓ Status: planning → in_progress", Colors.GREEN))
    print()
    print(colored("The hook will now inject context from this task's jsonl files.", Colors.BLUE))
    run_task_hooks("after_start", task_json_path, repo_root)
    return 0
