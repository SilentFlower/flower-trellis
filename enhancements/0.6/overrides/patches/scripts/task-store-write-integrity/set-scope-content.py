    data["scope"] = scope
    if not write_json(task_json, data):
        print(colored("Error: Failed to persist scope", Colors.RED))
        return 1
