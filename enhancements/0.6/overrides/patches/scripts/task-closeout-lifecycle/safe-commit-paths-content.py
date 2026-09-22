def safe_trellis_paths_to_add(
    repo_root: Path,
    task_name: str | None = None,
) -> list[str]:
    """Return existing Trellis-owned paths for one session auto-commit.

    Args:
        repo_root: Repository root containing the Trellis workspace.
        task_name: Optional top-level task directory to stage narrowly.

    Returns:
        Repo-relative journal, workspace index, and eligible task paths.
    """
    paths: list[str] = []
    developer = get_developer(repo_root)
    if developer:
        workspace = repo_root / DIR_WORKFLOW / DIR_WORKSPACE / developer
        if workspace.is_dir():
            for journal in sorted(workspace.glob(f"{FILE_JOURNAL_PREFIX}*.md")):
                if journal.is_file():
                    paths.append(
                        f"{DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/{journal.name}"
                    )
            index_md = workspace / "index.md"
            if index_md.is_file():
                paths.append(f"{DIR_WORKFLOW}/{DIR_WORKSPACE}/{developer}/index.md")

    tasks_dir = repo_root / DIR_WORKFLOW / DIR_TASKS
    if not tasks_dir.is_dir():
        return paths
    if task_name is not None:
        task_dir = tasks_dir / task_name
        if task_dir.is_dir() and task_dir.parent == tasks_dir:
            paths.append(f"{DIR_WORKFLOW}/{DIR_TASKS}/{task_name}")
        return paths

    for child in sorted(tasks_dir.iterdir()):
        if child.is_dir() and child.name != "archive":
            paths.append(f"{DIR_WORKFLOW}/{DIR_TASKS}/{child.name}")
    return paths
