    data["branch"] = branch
    if not write_json(task_json, data):
        print(colored("Error: Failed to persist branch", Colors.RED))
        return 1
