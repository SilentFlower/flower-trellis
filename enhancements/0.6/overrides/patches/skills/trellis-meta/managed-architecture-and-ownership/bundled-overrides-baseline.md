## Overriding a Bundled Skill Locally

There is no formal "project-local skill" mechanism (e.g. `.trellis/skills/`). Bundled skills are platform-rooted, so any override is platform-rooted too.

The supported pattern relies on the existing template-hash diff in `trellis update`:

1. Edit the local file directly. Example: `.claude/skills/trellis-meta/SKILL.md`.
2. The file's hash now diverges from the entry in `.trellis/.template-hashes.json`.
3. The next `trellis update` detects the user modification and leaves the file untouched (Trellis never overwrites user-modified files without an explicit `--force`).

Caveats:

- The override only applies to the one platform whose directory you edited. To override the same skill across, for example, Claude Code and Codex, you must edit both `.claude/skills/<name>/` and `.agents/skills/<name>/`.
- A future `trellis update --force` will overwrite local edits. Keep the override under version control so it can be reapplied if needed.
- Marketplace skills installed under the same platform skill root with a different folder name (e.g. `.claude/skills/my-custom-meta/`) are untouched by Trellis and are the cleaner option when the goal is to add behavior, not to mutate the bundled skill.
- Team-private conventions belong in `.trellis/spec/` or in a separate marketplace-style local skill, not in modifications to `trellis-meta` itself. See `customize-local/add-project-local-conventions.md`.
