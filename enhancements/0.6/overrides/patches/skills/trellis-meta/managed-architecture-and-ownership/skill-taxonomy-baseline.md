## What Counts As Bundled (vs. Adjacent Concepts)

| Source path | Type | How it ships |
| --- | --- | --- |
| `templates/common/bundled-skills/<name>/` | Bundled skill (multi-file) | Whole directory copied to every platform skill root |
| `templates/common/skills/<name>.md` | Single-file workflow skill | Wrapped with frontmatter, written as `<root>/<name>/SKILL.md` |
| `templates/common/commands/<name>.md` | Slash command / prompt | Written to each platform's command directory (`.claude/commands/trellis/`, `.cursor/commands/trellis-*.md`, `.gemini/commands/trellis/*.toml`, etc.) |
| `templates/<platform>/skills/` | Platform-specific skill | Written only into that platform's directory (e.g. `.codex/skills/`) |
| User skills under `.claude/skills/<my-skill>/` etc. | Marketplace or user-authored | Not managed by Trellis at all |

The Trellis CLI never touches anything that is not produced by one of its own template loaders. Anything a user drops into a platform skill root by hand is left alone.
