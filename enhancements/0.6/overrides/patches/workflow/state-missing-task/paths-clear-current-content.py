def clear_current_task(
    repo_root: Path | None = None,
    platform_input: dict | None = None,
    platform: str | None = None,
) -> bool:
    """Clear current task in session scope.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
        platform_input: Platform hook input.
        platform: Explicit platform name.

    Returns:
        True only when the selected session state was cleared or already absent.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    from .active_task import clear_active_task

    result = clear_active_task(
        repo_root,
        platform_input=platform_input,
        platform=platform,
    )
    return result.cleared
