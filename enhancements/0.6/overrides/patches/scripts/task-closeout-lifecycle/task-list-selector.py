def cmd_list(args: argparse.Namespace) -> int:
    """List active tasks."""
    repo_root = get_repo_root()
    tasks_dir = get_tasks_dir(repo_root)
    current_task = get_current_task(repo_root)
    developer = get_developer(repo_root)
    filter_mine = args.mine
    filter_status = args.status
    as_json = getattr(args, "json", False)

    # Single pass: collect all tasks via shared iterator
    all_tasks = {t.dir_name: t for t in iter_active_tasks(tasks_dir)}
    all_statuses = {name: t.status for name, t in all_tasks.items()}

    if as_json:
        if filter_mine and not developer:
            print(json.dumps({"error": "No developer set"}), file=sys.stderr)
            return 1

        items = []
        for dir_name in sorted(all_tasks.keys()):
            t = all_tasks[dir_name]
            if filter_mine and (t.assignee or "-") != developer:
                continue
            if filter_status and t.status != filter_status:
                continue
            items.append({
                "dir": f"{DIR_WORKFLOW}/{DIR_TASKS}/{dir_name}",
                "id": t.raw.get("id") or dir_name,
                "title": t.title,
                "status": t.status,
                "display_status": _display_status(t, all_statuses),
                "priority": t.priority,
                "assignee": t.assignee or None,
                "parent": t.parent,
                "children": list(t.children),
                "package": t.package,
            })
        print(json.dumps({"tasks": items}, ensure_ascii=False))
        return 0

    if filter_mine:
        if not developer:
            print(colored("Error: No developer set. Run init_developer.py first", Colors.RED), file=sys.stderr)
            return 1
        print(colored(f"My tasks (assignee: {developer}):", Colors.BLUE))
    else:
        print(colored("All active tasks:", Colors.BLUE))
    print()

    # Display tasks hierarchically
    count = 0

    def _print_task(dir_name: str, indent: int = 0) -> None:
        nonlocal count
        t = all_tasks[dir_name]

        # Apply --mine filter
        if filter_mine and (t.assignee or "-") != developer:
            return

        # Apply --status filter
        if filter_status and t.status != filter_status:
            return

        relative_path = f"{DIR_WORKFLOW}/{DIR_TASKS}/{dir_name}"
        marker = ""
        if relative_path == current_task:
            marker = f" {colored('<- current', Colors.GREEN)}"

        # Children progress
        progress = children_progress(t.children, all_statuses)
        status_label = _display_status(t, all_statuses)

        # Package tag
        pkg_tag = f" @{t.package}" if t.package else ""

        prefix = "  " * indent + "  - "

        if filter_mine:
            print(f"{prefix}{dir_name}/ ({status_label}){pkg_tag}{progress}{marker}")
        else:
            print(f"{prefix}{dir_name}/ ({status_label}){pkg_tag}{progress} [{colored(t.assignee or '-', Colors.CYAN)}]{marker}")
        count += 1

        # Print children indented
        for child_name in t.children:
            if child_name in all_tasks:
                _print_task(child_name, indent + 1)

    # Display only top-level tasks: those without a parent, plus orphans
    # whose recorded parent is not (or no longer) in the active set — a
    # dangling parent ref must still render flat instead of disappearing.
    for dir_name in sorted(all_tasks.keys()):
        parent = all_tasks[dir_name].parent
        if not parent or parent not in all_tasks:
            _print_task(dir_name)

    if count == 0:
        if filter_mine:
            print("  (no tasks assigned to you)")
        else:
            print("  (no active tasks)")

    print()
    print(f"Total: {count} task(s)")
    return 0
