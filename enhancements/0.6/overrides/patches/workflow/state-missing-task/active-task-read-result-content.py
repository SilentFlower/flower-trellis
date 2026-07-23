

def _read_json_result(path: Path) -> dict[str, Any]:
    """Read runtime JSON while preserving missing/corrupt/I/O distinctions."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"status": "missing", "data": None, "error": None}
    except json.JSONDecodeError as error:
        return {"status": "corrupt", "data": None, "error": str(error)}
    except OSError as error:
        return {"status": "io_error", "data": None, "error": str(error)}
    if not isinstance(data, dict):
        return {"status": "corrupt", "data": None, "error": "JSON root is not an object"}
    return {"status": "ok", "data": data, "error": None}
