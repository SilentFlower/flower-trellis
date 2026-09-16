def _configure_stream(stream: object) -> object:
    """Configure a stream for UTF-8 encoding on Windows."""
    # Try reconfigure() first (Python 3.7+, more reliable)
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        return stream
    # Fallback: detach and rewrap with TextIOWrapper
    elif hasattr(stream, "detach"):
        return io.TextIOWrapper(
            stream.detach(),  # type: ignore[union-attr]
            encoding="utf-8",
            errors="replace",
        )
    return stream
