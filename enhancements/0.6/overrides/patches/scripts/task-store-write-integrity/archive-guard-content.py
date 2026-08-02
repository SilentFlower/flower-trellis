
    task_data = read_json(task_json_path) if task_json_path.is_file() else None
    if not task_data:
        print(colored(f"Error: task.json not found or invalid: {task_json_path}", Colors.RED), file=sys.stderr)
        return 1
    if task_data.get("status") != "completed" or not task_data.get("completedAt"):
        print(
            colored("Error: only completed tasks with completedAt can be archived", Colors.RED),
            file=sys.stderr,
        )
        print(
            "Hint: complete the normal trellis-push progress sync before finish-work archive.",
            file=sys.stderr,
        )
        return 1

    try:
        decision_status = decision_review_status(task_dir)
    except DecisionLogError as error:
        print(colored(f"Error: Decision log is invalid: {error}", Colors.RED), file=sys.stderr)
        return 1
    if not decision_status["archive_allowed"]:
        print(colored("Error: AI decisions require review before archive.", Colors.RED), file=sys.stderr)
        print(
            "Hint: Run decision_log.py status --task <task> --json, then record an accepted review.",
            file=sys.stderr,
        )
        return 1
