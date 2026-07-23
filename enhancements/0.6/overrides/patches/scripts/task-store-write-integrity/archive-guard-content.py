
    if not task_json_path.is_file() or not read_json(task_json_path):
        print(colored(f"Error: task.json not found or invalid: {task_json_path}", Colors.RED), file=sys.stderr)
        return 1
