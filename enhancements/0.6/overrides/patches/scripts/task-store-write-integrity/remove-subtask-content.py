    parent_original = read_json(parent_json_path)
    child_original = read_json(child_json_path)
    if not parent_original or not child_original:
        print(colored("Error: Failed to capture task relationship snapshots", Colors.RED), file=sys.stderr)
        return 1
    written, restored = _write_task_pair(
        parent_json_path,
        parent_data,
        parent_original,
        child_json_path,
        child_data,
        child_original,
    )
    if not written:
        print(colored("Error: Failed to persist parent/child relationship removal", Colors.RED), file=sys.stderr)
        if not restored:
            print(colored(
                f"Error: Relationship rollback incomplete; inspect {parent_json_path} and {child_json_path}",
                Colors.RED,
            ), file=sys.stderr)
        return 1

    print(colored(f"Unlinked: {child_dir.name} from {parent_dir.name}", Colors.GREEN), file=sys.stderr)
