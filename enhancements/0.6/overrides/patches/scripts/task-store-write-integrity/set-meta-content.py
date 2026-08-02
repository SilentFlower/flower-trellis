    meta[key] = value
    data["meta"] = meta
    if not write_json(task_json, data):
        print(colored("Error: Failed to persist task metadata", Colors.RED))
        return 1
