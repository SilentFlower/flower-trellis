def cmd_list(args: argparse.Namespace) -> int:
    """List active, closed, or all tasks through shared lifecycle views.

    Args:
        args: List filters and output mode.

    Returns:
        Process exit code.
    """
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    current_task = get_current_task(repo_root)
    developer = get_developer(repo_root)
    filter_mine = args.mine
    filter_status = args.status
    as_json = getattr(args, "json", False)
    if getattr(args, "closed", False):
        view_name = "closed"
        selected = iter_closed_tasks(tasks_dir)
    elif getattr(args, "all", False):
        view_name = "all"
        selected = iter_task_records(tasks_dir)
    else:
        view_name = "active"
        selected = iter_active_tasks(tasks_dir)
    tasks = {task.dir_name: task for task in selected}
    all_statuses = get_all_statuses(tasks_dir)

    if filter_mine and not developer:
        if as_json:
            print(json.dumps({"error": "No developer set"}), file=sys.stderr)
        else:
            print(colored("Error: No developer set. Run init_developer.py first", Colors.RED), file=sys.stderr)
        return 1

    def _included(task) -> bool:
        """Apply assignee and work-status filters to one task."""
        if filter_mine and (task.assignee or "-") != developer:
            return False
        return not filter_status or task.status == filter_status

    if as_json:
        items = []
        for dir_name in sorted(tasks):
            task = tasks[dir_name]
            if not _included(task):
                continue
            closeout = task_closeout_view(task, tasks_dir)
            items.append({
                "dir": task.directory.relative_to(repo_root).as_posix(),
                "id": task.raw.get("id") or dir_name,
                "title": task.title,
                "status": task.status,
                "display_status": _display_status(task, all_statuses),
                "closeout": closeout,
                "priority": task.priority,
                "assignee": task.assignee or None,
                "parent": task.parent,
                "children": list(task.children),
                "package": task.package,
            })
        print(json.dumps({"view": view_name, "tasks": items}, ensure_ascii=False))
        return 0

    labels = {"active": "Active tasks", "closed": "Closed tasks", "all": "All tasks"}
    prefix = "My" if filter_mine else labels[view_name]
    if filter_mine:
        print(colored(f"{prefix} {view_name} tasks (assignee: {developer}):", Colors.BLUE))
    else:
        print(colored(f"{prefix}:", Colors.BLUE))
    print()
    count = 0

    def _print_task(dir_name: str, indent: int = 0) -> None:
        """Print one visible task and its visible children."""
        nonlocal count
        task = tasks[dir_name]
        if not _included(task):
            return
        try:
            relative_path = task.directory.relative_to(repo_root).as_posix()
        except ValueError:
            relative_path = str(task.directory)
        marker = f" {colored('<- current', Colors.GREEN)}" if relative_path == current_task else ""
        progress = children_progress(task.children, all_statuses)
        status_label = _display_status(task, all_statuses)
        package_tag = f" @{task.package}" if task.package else ""
        line_prefix = "  " * indent + "  - "
        if filter_mine:
            print(f"{line_prefix}{dir_name}/ ({status_label}){package_tag}{progress}{marker}")
        else:
            print(
                f"{line_prefix}{dir_name}/ ({status_label}){package_tag}{progress} "
                f"[{colored(task.assignee or '-', Colors.CYAN)}]{marker}"
            )
        count += 1
        for child_name in task.children:
            if child_name in tasks:
                _print_task(child_name, indent + 1)

    for dir_name in sorted(tasks):
        parent = tasks[dir_name].parent
        if not parent or parent not in tasks:
            _print_task(dir_name)
    if count == 0:
        print(f"  (no {view_name} tasks)")
    print()
    print(f"Total: {count} task(s)")
    return 0
