

@dataclass(frozen=True)
class ClearActiveTaskResult:
    """Result of clearing a session-scoped active task.

    Args:
        active: Task resolved before cleanup.
        cleared: Whether the target session state is absent after the operation.
        error: Stable diagnostic when cleanup failed.
    """

    active: ActiveTask
    cleared: bool
    error: str | None = None

    @property
    def task_path(self) -> str | None:
        """Return the task path resolved before cleanup."""
        return self.active.task_path

    @property
    def source(self) -> str:
        """Return the human-readable source resolved before cleanup."""
        return self.active.source
