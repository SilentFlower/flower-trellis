if sys.platform.startswith("win"):
    _stdout_reconfigure = getattr(sys.stdout, "reconfigure", None)
    if callable(_stdout_reconfigure):
        try:
            _stdout_reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass
