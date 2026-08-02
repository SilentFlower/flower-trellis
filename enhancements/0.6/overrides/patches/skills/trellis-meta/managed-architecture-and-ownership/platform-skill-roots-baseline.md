## Where Bundled Skills Land Per Platform

Each platform configurator calls `writeSkills(<root>, <workflowSkills>, resolveBundledSkills(ctx))` during `trellis init`. `resolveBundledSkills` reads every directory under `templates/common/bundled-skills/`, resolves placeholders, and returns a flat list of `{relativePath, content}` entries. `writeSkills` then mirrors them under the platform's skill root.

| Platform | Bundled skill root | Notes |
| --- | --- | --- |
| Claude Code | `.claude/skills/<skill>/` | `configureClaude` |
| Cursor | `.cursor/skills/<skill>/` | `configureCursor` |
| Codex | `.agents/skills/<skill>/` | `configureCodex` writes the shared `.agents/skills/` root, which Gemini CLI 0.40+ also reads |
| Gemini CLI | `.agents/skills/<skill>/` | Same shared root as Codex; the two configurators are required to produce byte-identical output |
| Kiro | `.kiro/skills/<skill>/` | `configureKiro` (skills-based platform — no commands) |
| Qoder | `.qoder/skills/<skill>/` | `configureQoder` |
| Codebuddy | `.codebuddy/skills/<skill>/` | `configureCodebuddy` |
| Copilot | `.github/skills/<skill>/` | `configureCopilot` |
| Droid | `.factory/skills/<skill>/` | `configureDroid` |
| Antigravity | `.agent/skills/<skill>/` | `configureAntigravity` |
| Devin | `.devin/skills/<skill>/` | `configureDevin` |
| Kilo | `.kilocode/skills/<skill>/` | `configureKilo` |
| ZCode | `.zcode/skills/<skill>/` | `configureZcode` |
| OpenCode | (handled by `collectOpenCodeTemplates`) | Uses the same `resolveBundledSkills(ctx)` output |
| Pi, Reasonix | (their own collectors) | Same `resolveBundledSkills(ctx)` output |

Two paths exercise the same data:

1. `configureX(cwd)` writes files during `trellis init`.
2. `collectPlatformTemplates(platformId)` (in `configurators/index.ts`) returns a `Map<filePath, content>` that `trellis update` uses to detect drift and to populate `.trellis/.template-hashes.json`. Both must produce byte-identical output, so they both call `resolveBundledSkills(ctx)` and `collectSkillTemplates(root, …, resolveBundledSkills(ctx))`.
