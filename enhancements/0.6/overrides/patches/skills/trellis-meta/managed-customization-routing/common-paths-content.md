## Common Paths

| Platform | Entry directories |
| --- | --- |
| Claude Code | `.claude/skills/`, `.claude/commands/` |
| Cursor | `.cursor/skills/`, `.cursor/commands/` |
| OpenCode | `.opencode/skills/`, `.opencode/commands/` |
| Codex | `.agents/skills/`, `.codex/skills/` |
| Gemini CLI | `.agents/skills/`, `.gemini/commands/` |
| Kiro | `.kiro/skills/` |
| Qoder | `.qoder/skills/`, `.qoder/commands/` |
| CodeBuddy | `.codebuddy/skills/`, `.codebuddy/commands/` |
| GitHub Copilot | `.github/skills/`, `.github/prompts/` |
| Factory Droid | `.factory/skills/`, `.factory/commands/` |
| Pi Agent | `.agents/skills/`, `.pi/prompts/` |
| Oh My Pi | `.omp/skills/`, `.omp/commands/` |
| Grok Build | `.grok/skills/`, `.grok/commands/` |
| Kimi Code | `.agents/skills/`, `.kimi-code/skills/` |
| Snow CLI | `.snow/skills/`, `.snow/commands/` |
| Reasonix | `.reasonix/skills/` (no separate commands dir; slash commands built into the platform) |
| ZCode | `.zcode/skills/`, `.zcode/commands/` |
| Kilo / Antigravity / Devin / Trae | workflows or commands + skills |

Only each platform's skill root receives the bundled skills. `.agents/skills/` is the shared root used by Codex, Gemini CLI, Pi Agent, and Kimi Code; `.pi/prompts/` and `.kimi-code/skills/` contain their platform-private entry points rather than another bundled-skill copy.
