
    if not task_json_path.is_file() or not read_json(task_json_path):
        print(colored(f"Error: task.json not found or invalid: {task_json_path}", Colors.RED), file=sys.stderr)
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
