

def _clone_json(data: dict) -> dict:
    """Return a detached JSON-compatible snapshot for local compensation."""
    return json.loads(json.dumps(data))


def _cleanup_created_task(task_dir: Path) -> bool:
    """Remove only the directory created by the current create command."""
    from shutil import rmtree

    try:
        rmtree(task_dir)
        return True
    except FileNotFoundError:
        return True
    except OSError:
        return False


def _write_task_pair(
    first_path: Path,
    first_data: dict,
    first_original: dict,
    second_path: Path,
    second_data: dict,
    second_original: dict,
) -> tuple[bool, bool]:
    """Write a parent/child pair and restore both snapshots on partial failure."""
    if not write_json(first_path, first_data):
        return False, True
    if write_json(second_path, second_data):
        return True, True
    first_restored = write_json(first_path, first_original)
    second_restored = write_json(second_path, second_original)
    return False, first_restored and second_restored
