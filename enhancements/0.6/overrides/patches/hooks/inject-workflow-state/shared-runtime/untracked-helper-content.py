

def _get_untracked_work(root: Path, input_data: dict) -> Optional[tuple[str, str, str]]:
    """Return (work_id, stage, summary) for the current session's untracked work."""
    scripts_dir = root / ".trellis" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from untracked_flow import read_untracked_state  # type: ignore[import-not-found]

        result = read_untracked_state(
            root,
            input_data,
            platform=_detect_platform(input_data),
        )
    except Exception:
        return None
    if result.get("status") != "hit":
        return None
    work_id = result.get("workId")
    stage = result.get("stage")
    summary = result.get("summary")
    if not all(isinstance(value, str) and value for value in (work_id, stage, summary)):
        return None
    return work_id, stage, summary
