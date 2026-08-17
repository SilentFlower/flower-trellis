            # completedAt 仅是审计元数据；兼容旧任务时在移动前补齐，不把缺失元数据当作非法状态。
            if not data.get("completedAt"):
                data["completedAt"] = today
                if not write_json(task_json_path, data):
                    print(colored("Error: Failed to persist completedAt before archive", Colors.RED), file=sys.stderr)
                    return 1
                print(
                    colored(f"Warning: completedAt was missing and has been set to {today}.", Colors.YELLOW),
                    file=sys.stderr,
                )
