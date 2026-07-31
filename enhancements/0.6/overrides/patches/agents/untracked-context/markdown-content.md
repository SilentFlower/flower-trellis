## Trellis Context Loading Protocol

Resolve exactly one dispatch subject from the first prompt line:

- `Active task: <path>`: use the normal task path. Read the role manifest (`implement.jsonl` for implement, `check.jsonl` for check), every listed file, then `prd.md`, optional `design.md`, and optional `implement.md`.
- `Untracked work: <work-id>`: run `python3 ./.trellis/scripts/untracked_flow.py status --verbose`, require the same work id, and use the complete summary/scope/baseline/fingerprint/evidence/spec context supplied by the main session. Do not require or invent task artifacts or JSONL files.

If hook-injected context is present, it may satisfy the task branch. The untracked branch remains prompt-driven and must still validate the helper state. If neither first-line contract is present or the resolved subject mismatches, stop and report the missing context; do not guess or switch subjects.
