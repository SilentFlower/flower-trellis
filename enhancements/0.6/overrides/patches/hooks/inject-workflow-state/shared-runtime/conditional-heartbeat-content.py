import hashlib
import time


CONDITIONAL_WORKFLOW_STATE_PLATFORMS = {"codex", "claude"}
DEFAULT_WORKFLOW_STATE_HEARTBEAT_TURNS = 5
WORKFLOW_STATE_TRACKER_VERSION = 1
WORKFLOW_STATE_REFRESH_ARG = "--trellis-session-start-refresh"


def _resolve_heartbeat_turns(config: dict) -> int:
    """Return the configured unchanged-turn heartbeat interval."""
    raw = DEFAULT_WORKFLOW_STATE_HEARTBEAT_TURNS
    if isinstance(config, dict):
        section = config.get("prompt_injection")
        if isinstance(section, dict):
            raw = section.get("heartbeat_turns", raw)
    if isinstance(raw, bool):
        return DEFAULT_WORKFLOW_STATE_HEARTBEAT_TURNS
    if isinstance(raw, int):
        return raw if raw >= 0 else DEFAULT_WORKFLOW_STATE_HEARTBEAT_TURNS
    if isinstance(raw, str) and re.fullmatch(r"[+-]?\d+", raw.strip()):
        value = int(raw.strip())
        return value if value >= 0 else DEFAULT_WORKFLOW_STATE_HEARTBEAT_TURNS
    return DEFAULT_WORKFLOW_STATE_HEARTBEAT_TURNS


def _resolve_workflow_state_context_key(
    root: Path, input_data: dict, platform: str
) -> str | None:
    """Resolve the host session identity through Trellis' shared helper."""
    scripts_dir = root / ".trellis" / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from common.active_task import resolve_context_key  # type: ignore[import-not-found]

        context_key = resolve_context_key(input_data, platform)
    except Exception:
        return None
    return context_key if isinstance(context_key, str) and context_key else None


def _workflow_state_tracker_path(
    root: Path, platform: str, context_key: str
) -> Path:
    """Return the opaque per-platform, per-session tracker path."""
    identity = hashlib.sha256(f"{platform}:{context_key}".encode("utf-8")).hexdigest()
    return root / ".trellis" / ".runtime" / "workflow-state" / f"{identity}.json"


def _read_workflow_state_tracker(path: Path, platform: str) -> dict | None:
    """Read and strictly validate a workflow-state tracker."""
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    if not isinstance(value, dict):
        return None
    expected_keys = {
        "version",
        "platform",
        "fingerprint",
        "unchangedTurns",
        "heartbeatTurns",
        "updatedAt",
    }
    if set(value) != expected_keys:
        return None
    if value.get("version") != WORKFLOW_STATE_TRACKER_VERSION:
        return None
    if value.get("platform") != platform:
        return None
    fingerprint = value.get("fingerprint")
    if not isinstance(fingerprint, str) or re.fullmatch(r"[0-9a-f]{64}", fingerprint) is None:
        return None
    unchanged_turns = value.get("unchangedTurns")
    heartbeat_turns = value.get("heartbeatTurns")
    if isinstance(unchanged_turns, bool) or not isinstance(unchanged_turns, int):
        return None
    if isinstance(heartbeat_turns, bool) or not isinstance(heartbeat_turns, int):
        return None
    if unchanged_turns < 0 or heartbeat_turns < 0:
        return None
    if heartbeat_turns == 0 and unchanged_turns != 0:
        return None
    if heartbeat_turns > 0 and unchanged_turns >= heartbeat_turns:
        return None
    updated_at = value.get("updatedAt")
    if not isinstance(updated_at, str) or not updated_at:
        return None
    try:
        time.strptime(updated_at, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None
    return value


def _workflow_state_record(
    platform: str,
    fingerprint: str,
    unchanged_turns: int,
    heartbeat_turns: int,
) -> dict:
    """Build the versioned tracker payload."""
    return {
        "version": WORKFLOW_STATE_TRACKER_VERSION,
        "platform": platform,
        "fingerprint": fingerprint,
        "unchangedTurns": unchanged_turns,
        "heartbeatTurns": heartbeat_turns,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _write_workflow_state_tracker(path: Path, value: dict) -> bool:
    """Atomically replace a workflow-state tracker after flushing it."""
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp"
    )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with temporary.open("x", encoding="utf-8") as handle:
            handle.write(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        return True
    except OSError:
        try:
            temporary.unlink()
        except OSError:
            pass
        return False


def _workflow_state_body(
    templates: dict[str, str], status: str, breadcrumb_key: str
) -> str:
    """Return the exact selected workflow-state body or the standard fallback."""
    body = templates.get(breadcrumb_key)
    if body is None and breadcrumb_key != status:
        body = templates.get(status)
    return body if body is not None else "Refer to workflow.md for current step."


def _workflow_state_action(
    templates: dict[str, str], status: str, breadcrumb_key: str
) -> str:
    """Extract the first visible action line from the selected state body."""
    body = _workflow_state_body(templates, status, breadcrumb_key)
    visible = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
    for raw_line in visible.splitlines():
        line = raw_line.strip()
        if line:
            return line
    return "Refer to workflow.md for current step."


def _build_workflow_state_heartbeat(
    subject: str,
    action: str,
    heartbeat_turns: int,
    subject_summary: str | None = None,
) -> str:
    """Build an actionable reminder without repeating the full state body."""
    lines = ["<workflow-state-heartbeat>", subject]
    if subject_summary:
        lines.append(f"Summary: {subject_summary}")
    lines.extend(
        [
            f"Action: {action}",
            (
                f"State unchanged for {heartbeat_turns} user turns. "
                "Continue following the latest full <workflow-state> block."
            ),
            "</workflow-state-heartbeat>",
        ]
    )
    return "\n".join(lines)


def _conditional_workflow_state_context(
    root: Path,
    input_data: dict,
    platform: str | None,
    config: dict,
    full_context: str,
    heartbeat: str,
    force_refresh: bool,
) -> str | None:
    """Choose a full state, heartbeat, or silent output for the current event."""
    if platform not in CONDITIONAL_WORKFLOW_STATE_PLATFORMS:
        return full_context

    context_key = _resolve_workflow_state_context_key(root, input_data, platform)
    if context_key is None:
        return full_context

    heartbeat_turns = _resolve_heartbeat_turns(config)
    fingerprint = hashlib.sha256(full_context.encode("utf-8")).hexdigest()
    tracker_path = _workflow_state_tracker_path(root, platform, context_key)
    tracker = _read_workflow_state_tracker(tracker_path, platform)

    if force_refresh or tracker is None or tracker["fingerprint"] != fingerprint:
        baseline = _workflow_state_record(platform, fingerprint, 0, heartbeat_turns)
        _write_workflow_state_tracker(tracker_path, baseline)
        return full_context

    if tracker["heartbeatTurns"] != heartbeat_turns:
        baseline = _workflow_state_record(platform, fingerprint, 0, heartbeat_turns)
        if not _write_workflow_state_tracker(tracker_path, baseline):
            return full_context
        return None

    unchanged_turns = 0 if heartbeat_turns == 0 else tracker["unchangedTurns"] + 1
    output = None
    if heartbeat_turns > 0 and unchanged_turns >= heartbeat_turns:
        unchanged_turns = 0
        output = heartbeat
    next_record = _workflow_state_record(
        platform, fingerprint, unchanged_turns, heartbeat_turns
    )
    if not _write_workflow_state_tracker(tracker_path, next_record):
        return full_context
    return output
