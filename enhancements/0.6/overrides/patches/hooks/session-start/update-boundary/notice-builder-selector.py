def _build_first_reply_notice(update_hint: str | None) -> str:
    """First-reply notice, carrying the Trellis update reminder when there is one.

    The reminder has to reach the *user*, not just the model's context — a line
    buried in SessionStart context is exactly how the update step kept getting
    skipped. This block is already the payload's one "say it out loud" channel,
    so the hint rides along instead of growing a second mechanism.

    With no hint the notice is byte-identical to the plain constant: no empty
    block, no placeholder line.
    """
    if not update_hint:
        return FIRST_REPLY_NOTICE
    return (
        f"{_FIRST_REPLY_NOTICE_HEAD}\n"
        f"Also relay this Trellis maintenance notice on its own line in that same reply: {update_hint}\n"
        f"{_FIRST_REPLY_NOTICE_TAIL}"
    )
