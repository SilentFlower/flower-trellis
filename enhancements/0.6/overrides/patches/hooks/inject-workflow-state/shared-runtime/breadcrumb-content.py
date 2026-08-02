def build_breadcrumb(
    task_id: Optional[str],
    status: str,
    templates: dict[str, str],
    source: str | None = None,
    breadcrumb_key: str | None = None,
    subject_label: str | None = None,
    subject_summary: str | None = None,
) -> str:
    """Build the <workflow-state>...</workflow-state> block.

    - Known status (tag present in workflow.md) → detailed template body
    - Unknown status (no tag, or workflow.md missing) → generic
      "Refer to workflow.md for current step." line
    - `no_task` pseudo-status (task_id is None) → header omits task info
    """
    lookup_key = breadcrumb_key or status
    body = templates.get(lookup_key)
    if body is None and lookup_key != status:
        body = templates.get(status)
    if body is None:
        body = "Refer to workflow.md for current step."
    if subject_label:
        header = subject_label
    else:
        header = f"Status: {status}" if task_id is None else f"Task: {task_id} ({status})"
    if subject_summary:
        body = f"Summary: {subject_summary}\n{body}"
    return f"<workflow-state>\n{header}\n{body}\n</workflow-state>"
