def _configure_stream(stream: object) -> object:
    """Configure UTF-8 where supported without taking ownership of the stream."""
    reconfigure = getattr(stream, "reconfigure", None)
    if callable(reconfigure):
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass
    # In-memory and host-owned streams must remain attached and open.
    return stream
