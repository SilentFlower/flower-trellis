    # Handle --parent: establish bidirectional link or fail the create command.
    if args.parent:
        parent_dir = resolve_task_dir(args.parent, repo_root)
        parent_json_path = parent_dir / FILE_TASK_JSON
        parent_data = read_json(parent_json_path) if parent_json_path.is_file() else None
        if not parent_data:
            _cleanup_created_task(task_dir)
            print(colored(f"Error: Parent task.json not found or invalid: {args.parent}", Colors.RED), file=sys.stderr)
            return 1

        parent_original = _clone_json(parent_data)
        child_original = _clone_json(task_data)
        parent_next = _clone_json(parent_data)
        child_next = _clone_json(task_data)
        parent_children = parent_next.get("children", [])
        if dir_name not in parent_children:
            parent_children.append(dir_name)
        parent_next["children"] = parent_children
        child_next["parent"] = parent_dir.name
        linked, restored = _write_task_pair(
            parent_json_path,
            parent_next,
            parent_original,
            task_json_path,
            child_next,
            child_original,
        )
        if not linked:
            _cleanup_created_task(task_dir)
            print(colored("Error: Failed to persist parent/child task relationship", Colors.RED), file=sys.stderr)
            if not restored:
                print(colored(
                    f"Error: Relationship rollback incomplete; inspect {parent_json_path} and {task_json_path}",
                    Colors.RED,
                ), file=sys.stderr)
            return 1
        task_data = child_next
        print(colored(f"Linked as child of: {parent_dir.name}", Colors.GREEN), file=sys.stderr)
