def _read_json(path: Path) -> dict[str, Any] | None:
    """Return a parsed JSON object for compatibility callers."""
    result = _read_json_result(path)
    data = result.get("data")
    return data if isinstance(data, dict) else None


def _write_json(path: Path, data: dict[str, Any]) -> bool:
    """Atomically replace runtime JSON after flushing file contents."""
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with temp_path.open("x", encoding="utf-8") as handle:
            handle.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        return True
    except OSError:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
        return False
