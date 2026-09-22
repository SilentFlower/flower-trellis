    # close
    p_close = subparsers.add_parser("close", help="Close a completed task")
    p_close.add_argument("task", help="Task directory or name")
    p_close.add_argument(
        "--resolve-blocker",
        action="append",
        default=[],
        help="Explicitly resolve one persisted semantic blocker code (repeatable)",
    )
    p_close.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    # gc
    p_gc = subparsers.add_parser("gc", help="Move expired closed tasks")
    p_gc.add_argument("--closed", action="store_true", help="Required closed-task selector")
    p_gc.add_argument("--before", default="3d", help="Minimum close age, for example 3d")
    p_gc.add_argument("--dry-run", action="store_true", help="Calculate without moving or committing")
    p_gc.add_argument("--json", action="store_true", help="Output machine-readable JSON")

    # restore
    p_restore = subparsers.add_parser("restore", help="Restore a physically moved task")
    p_restore.add_argument("task", help="Archived task directory or name")
    p_restore.add_argument("--dry-run", action="store_true", help="Calculate without moving or committing")
    p_restore.add_argument("--json", action="store_true", help="Output machine-readable JSON")
