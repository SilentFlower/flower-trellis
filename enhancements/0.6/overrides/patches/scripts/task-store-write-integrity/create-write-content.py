    if not write_json(task_json_path, task_data):
        cleaned = _cleanup_created_task(task_dir)
        print(colored("Error: Failed to write initial task.json", Colors.RED), file=sys.stderr)
        if not cleaned:
            print(colored(f"Error: Failed to clean incomplete task directory: {task_dir}", Colors.RED), file=sys.stderr)
        return 1

    prd_path = task_dir / "prd.md"
