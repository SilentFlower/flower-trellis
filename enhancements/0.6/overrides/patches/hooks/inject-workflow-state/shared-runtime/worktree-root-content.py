def _git_output(start: Path, *args: str) -> Optional[str]:
    """Run a read-only git command for best-effort Trellis root fallback."""
    import subprocess

    try:
        result = subprocess.run(
            ["git", "-C", str(start), *args],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    output = result.stdout.strip()
    return output or None


def _resolve_git_common_dir(start: Path) -> Optional[Path]:
    """Return the current repository's common git dir."""
    output = _git_output(start, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if output is None:
        output = _git_output(start, "rev-parse", "--git-common-dir")
    if output is None:
        return None
    common_dir = Path(output)
    if common_dir.is_absolute():
        return common_dir.resolve()
    top_level = _git_output(start, "rev-parse", "--show-toplevel")
    if top_level is None:
        return None
    return (Path(top_level) / common_dir).resolve()


def _find_trellis_root_from_git(start: Path) -> Optional[Path]:
    """Find a sibling worktree that carries .trellis/ for this Git repository."""
    common_dir = _resolve_git_common_dir(start)
    if common_dir is not None:
        candidate = common_dir.parent
        if (candidate / ".trellis").is_dir():
            return candidate

    output = _git_output(start, "worktree", "list", "--porcelain")
    if output is None:
        return None
    for line in output.splitlines():
        if not line.startswith("worktree "):
            continue
        candidate = Path(line.split(" ", 1)[1]).expanduser().resolve()
        if (candidate / ".trellis").is_dir():
            return candidate
    return None


def find_trellis_root(start: Path) -> Optional[Path]:
    """Walk up from start, then fall back to the Git worktree carrying .trellis/.

    Linked worktrees often do not contain the untracked .trellis/ runtime. The
    hook still needs the main worktree's runtime state so direct-edit cursors can
    be resumed from the linked worktree without copying .trellis/.
    """
    cur = start.resolve()
    while cur != cur.parent:
        if (cur / ".trellis").is_dir():
            return cur
        cur = cur.parent
    return _find_trellis_root_from_git(start.resolve())
