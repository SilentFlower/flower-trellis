def _read_project_version(repo_root: Path) -> str | None:
    try:
        version = (repo_root / DIR_WORKFLOW / ".version").read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        return None
    return version or None


def _fetch_trellis_version_output() -> str | None:
    try:
        result = subprocess.run(
            ["trellis", "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_UPDATE_CHECK_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError, TimeoutError):
        return None

    if result.returncode != 0:
        return None
    output = f"{result.stdout}\n{result.stderr}".strip()
    return output or None


def _extract_available_update_version(output: str) -> str | None:
    update_match = re.search(
        r"Trellis update available:\s*"
        r"(?P<current>\S+)\s*(?:→|->)\s*(?P<latest>\S+)",
        output,
    )
    if update_match:
        return update_match.group("latest").strip()
    candidates = _VERSION_TOKEN_RE.findall(output)
    return candidates[-1] if candidates else None


def _resolve_available_update_version() -> str | None:
    output = _fetch_trellis_version_output()
    if not output:
        return None
    return _extract_available_update_version(output)


def _parse_version(version: str) -> tuple[tuple[int, int, int], tuple[str, ...] | None] | None:
    match = _VERSION_RE.match(version)
    if not match:
        return None
    major, minor, patch, prerelease = match.groups()
    numbers = (int(major), int(minor or "0"), int(patch or "0"))
    prerelease_parts = tuple(prerelease.split(".")) if prerelease else None
    return numbers, prerelease_parts


def _compare_prerelease(
    left: tuple[str, ...] | None,
    right: tuple[str, ...] | None,
) -> int:
    if left is None and right is None:
        return 0
    if left is None:
        return 1
    if right is None:
        return -1

    for left_part, right_part in zip(left, right):
        if left_part == right_part:
            continue
        left_numeric = left_part.isdigit()
        right_numeric = right_part.isdigit()
        if left_numeric and right_numeric:
            left_int = int(left_part)
            right_int = int(right_part)
            return (left_int > right_int) - (left_int < right_int)
        if left_numeric:
            return -1
        if right_numeric:
            return 1
        return (left_part > right_part) - (left_part < right_part)

    return (len(left) > len(right)) - (len(left) < len(right))


def _compare_versions(left: str, right: str) -> int | None:
    parsed_left = _parse_version(left)
    parsed_right = _parse_version(right)
    if parsed_left is None or parsed_right is None:
        return None

    left_numbers, left_prerelease = parsed_left
    right_numbers, right_prerelease = parsed_right
    if left_numbers != right_numbers:
        return (left_numbers > right_numbers) - (left_numbers < right_numbers)
    return _compare_prerelease(left_prerelease, right_prerelease)


def _update_marker_path(repo_root: Path) -> Path:
    context_key = resolve_context_key()
    if not context_key:
        terminal_key = os.environ.get("TERM_SESSION_ID", "").strip()
        context_key = terminal_key or f"ppid-{os.getppid()}"
    safe_key = re.sub(r"[^A-Za-z0-9._-]+", "_", context_key).strip("._-")
    if not safe_key:
        safe_key = "session"
    return (
        repo_root
        / DIR_WORKFLOW
        / ".runtime"
        / f"update-check-{safe_key[:160]}.marker"
    )


def _mark_update_check_attempted(repo_root: Path) -> bool:
    marker_path = _update_marker_path(repo_root)
    if marker_path.exists():
        return False
    try:
        marker_path.parent.mkdir(parents=True, exist_ok=True)
        marker_path.write_text("checked\n", encoding="utf-8")
    except OSError:
        pass
    return True


def _get_update_hint(repo_root: Path) -> str | None:
    marker_path = _update_marker_path(repo_root)
    if marker_path.exists():
        return None

    current_version = _read_project_version(repo_root)
    if not current_version:
        return None

    latest_version = _resolve_available_update_version()
    if not latest_version:
        return None

    _mark_update_check_attempted(repo_root)
    comparison = _compare_versions(current_version, latest_version)
    if comparison is None or comparison >= 0:
        return None

    return (
        f"Trellis update available: {current_version} -> {latest_version}, "
        "run trellis update"
    )
