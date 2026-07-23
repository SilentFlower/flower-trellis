    if task_dir.exists():
        print(colored(f"Error: Task directory already exists: {dir_name}", Colors.RED), file=sys.stderr)
        return 1
    task_dir.mkdir(parents=True)
