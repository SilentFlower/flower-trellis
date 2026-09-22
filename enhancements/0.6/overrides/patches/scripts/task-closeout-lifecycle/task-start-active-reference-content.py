    # Start 只能绑定共享 active 视图中的任务，closed 任务必须先显式 reopen。
    try:
        full_path = resolve_active_task_reference(task_input, repo_root)
    except ValueError as error:
        print(colored(f"Error: {error}", Colors.RED))
        return 1
