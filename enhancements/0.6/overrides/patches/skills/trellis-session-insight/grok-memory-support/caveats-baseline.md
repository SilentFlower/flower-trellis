## Caveats

- **OpenCode adapter is a stub on `0.6.0-beta.*`.** When `--platform` resolves to OpenCode (or `all` and OpenCode would be included), `mem` prints a one-line "reader unavailable" notice and continues with the other platforms. Don't promise OpenCode coverage in your reply until the adapter ships.
- **`--phase` slicing depends on `task.py create` / `task.py start` invocations appearing in the recorded bash calls of the session.** Sessions where the user ran `task.py` from a different terminal — outside the recorded AI loop — will not have phase boundaries. `--phase all` is the safe fallback.
- **`mem` indexes platform JSONL files directly.** If the user has cleared their Claude / Codex / Pi session storage, `mem` cannot recover what is no longer on disk.
- **`mem` is read-only.** No remote sync, no edits to platform JSONL. Any write you do based on `mem` findings is your own follow-up call into the editing tools available to you.
