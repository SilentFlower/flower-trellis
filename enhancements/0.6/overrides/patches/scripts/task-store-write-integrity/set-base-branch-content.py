    data["base_branch"] = base_branch
    if not write_json(task_json, data):
        print(colored("Error: Failed to persist base branch", Colors.RED))
        return 1
