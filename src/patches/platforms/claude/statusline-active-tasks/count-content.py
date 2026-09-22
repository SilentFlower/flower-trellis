def _count_active_tasks(trellis_dir: Path) -> int:
    """Count tasks through the shared lifecycle-aware active view."""
    scripts_dir = trellis_dir / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from common.tasks import iter_active_tasks  # type: ignore[import-not-found]

    return sum(1 for _ in iter_active_tasks(trellis_dir / "tasks"))
