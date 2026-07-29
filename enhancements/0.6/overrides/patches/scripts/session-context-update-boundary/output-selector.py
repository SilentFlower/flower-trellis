def output_text(repo_root: Path | None = None) -> None:
    """Output context in text format.

    Args:
        repo_root: Repository root path. Defaults to auto-detected.
    """
    if repo_root is None:
        repo_root = get_repo_root()
    update_hint = _get_update_hint(repo_root)
    if update_hint:
        print(update_hint)
        print("")
    print(get_context_text(repo_root))
