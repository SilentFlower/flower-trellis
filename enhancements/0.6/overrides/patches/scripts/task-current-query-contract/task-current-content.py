def cmd_current(args: argparse.Namespace) -> int:
    """Show active task."""
    repo_root = get_repo_root()
    active = resolve_active_task(repo_root)

    if getattr(args, "json", False):
        task_obj = None
        if active.task_path:
            data = read_json(repo_root / active.task_path / FILE_TASK_JSON) or {}
            task_obj = {
                "dir": active.task_path,
                "id": data.get("id") or data.get("name"),
                "title": data.get("title"),
                "status": data.get("status"),
                "parent": data.get("parent"),
                "children": data.get("children", []),
                "branch": data.get("branch"),
                "base_branch": data.get("base_branch"),
            }
        print(json.dumps({
            "current_task": task_obj,
            "source": active.source,
            "stale": active.stale,
        }, ensure_ascii=False))
        return 0

    if args.source:
        print(f"Current task: {active.task_path or '(none)'}")
        print(f"Source: {active.source}")
        if active.stale:
            print("State: stale")
        return 0

    if active.task_path:
        print(active.task_path)
        return 0

    print(colored("No current task set", Colors.YELLOW))
    return 0
