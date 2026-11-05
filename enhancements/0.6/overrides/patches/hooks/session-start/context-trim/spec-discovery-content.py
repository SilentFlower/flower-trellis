    if ".trellis/spec/guides/index.md" in spec_index_paths:
        output.write("## Shared guidelines\n")
        output.write("- .trellis/spec/guides/index.md\n\n")

    output.write(
        "Read the active task's `implement.jsonl` or `check.jsonl` for task-specific guidelines. "
        "Find other relevant specs with "
        "`python3 ./.trellis/scripts/spec_router.py \"<task keywords>\"`.\n\n"
    )
