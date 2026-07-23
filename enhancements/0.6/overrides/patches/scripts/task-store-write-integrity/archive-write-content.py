            data["status"] = "completed"
            data["completedAt"] = today
            if not write_json(task_json_path, data):
                print(colored("Error: Failed to persist completed task status", Colors.RED), file=sys.stderr)
                return 1
