## Where Bundled Skills Land Per Platform

Each platform configurator writes the result of `resolveBundledSkills(ctx)` into a specific skill root during `trellis init`, and its collector must return the same paths for `trellis update` hash tracking.

| Platform | Bundled skill root | Notes |
| --- | --- | --- |
| Claude Code | `.claude/skills/<skill>/` | `configureClaude` |
| Cursor | `.cursor/skills/<skill>/` | `configureCursor` |
| OpenCode | `.opencode/skills/<skill>/` | `collectOpenCodeTemplates` and `configureOpenCode` |
| Codex | `.agents/skills/<skill>/` | Shared neutral root |
| Gemini CLI | `.agents/skills/<skill>/` | Shared neutral root |
| Pi Agent | `.agents/skills/<skill>/` | Shared neutral root; `.pi/` holds prompts, agents, extensions, and settings |
| Kimi Code | `.agents/skills/<skill>/` | Shared neutral root; `.kimi-code/skills/` holds commands and agent prompts, not bundled skills |
| Kiro | `.kiro/skills/<skill>/` | `configureKiro` |
| Qoder | `.qoder/skills/<skill>/` | `configureQoder` |
| CodeBuddy | `.codebuddy/skills/<skill>/` | `configureCodebuddy` |
| GitHub Copilot | `.github/skills/<skill>/` | `configureCopilot` |
| Factory Droid | `.factory/skills/<skill>/` | `configureDroid` |
| Antigravity | `.agent/skills/<skill>/` | `configureAntigravity` |
| Devin | `.devin/skills/<skill>/` | `configureDevin` |
| Kilo | `.kilocode/skills/<skill>/` | `configureKilo` |
| ZCode | `.zcode/skills/<skill>/` | `configureZcode` |
| Trae | `.trae/skills/<skill>/` | `configureTrae` |
| Reasonix | `.reasonix/skills/<skill>/` | Workflow, bundled, and sub-agent skills share one root |
| Oh My Pi | `.omp/skills/<skill>/` | `configureOmp` |
| Grok Build | `.grok/skills/<skill>/` | `configureGrok` |
| Snow CLI | `.snow/skills/<skill>/` | `configureSnow` |

The physical bundled-skill roots are therefore the platform-private roots above plus the single shared `.agents/skills/` root. `.pi/skills/` is not a current target, and `.kimi-code/skills/` must not receive a second bundled copy.

Two paths exercise the same data:

1. `configureX(cwd)` writes files during `trellis init`.
2. `collectPlatformTemplates(platformId)` (in `configurators/index.ts`) returns a `Map<filePath, content>` that `trellis update` uses to detect drift and to populate `.trellis/.template-hashes.json`.

Both paths must resolve to byte-identical bundled-skill output for a given root. Shared `.agents/skills/` writers additionally use the neutral resolver so Codex, Gemini CLI, Pi Agent, and Kimi Code do not overwrite each other with platform-specific text.
