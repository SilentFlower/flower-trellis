## Caveats

- **OpenCode conversation reading is still unavailable.** When `--platform` resolves to OpenCode, `mem` prints a reader-unavailable notice and continues with Claude, Codex, Grok, Pi, and ZCode. Do not promise OpenCode coverage until its adapter ships.
- **`--phase` slicing depends on recorded `task.py create` / `task.py start` tool calls.** Sessions where the user ran `task.py` from a different terminal may not have phase boundaries. `--phase all` is the safe fallback.
- **Compaction recovery is platform-store dependent.** Claude, Codex, Pi, and ZCode retain recoverable pre-compaction turns in their local stores. Grok may only retain a rendered transcript for compacted history; `mem` emits an explicit warning instead of claiming that missing dialogue was recovered.
- **`mem` reads platform-local stores only.** If the user clears `~/.claude/projects/`, `~/.codex/sessions/`, `~/.grok/sessions/`, Pi's configured session directory, or `~/.zcode/cli/db/db.sqlite`, `mem` cannot recover deleted history.
- **`mem` is read-only.** It does not upload, synchronize, or edit platform session stores. Any write based on a finding is a separate follow-up action.
