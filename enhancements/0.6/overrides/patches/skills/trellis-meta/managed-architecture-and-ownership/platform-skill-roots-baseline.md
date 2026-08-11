## Where Bundled Skills Land Per Platform

A platform's whole file set — commands, workflow skills, agents, hooks, bundled skills — is described exactly once, by `collect<Platform>Templates()` in `packages/cli/src/configurators/<platform>.ts`. For bundled skills that description is two calls: `resolveBundledSkills(ctx)` reads every directory under `templates/common/bundled-skills/`, resolves placeholders, and returns a flat list of `{relativePath, content}` entries; `collectSkillTemplates(<skillsRoot>, <workflowSkills>, <bundledSkills>)` folds them into the platform's `Map<filePath, content>` under `<skillsRoot>/<skill>/<relativePath>`.

All 21 platforms receive the full bundled-skill set:

| Platform | Bundled skill root |
| --- | --- |
| Claude Code | `.claude/skills/<skill>/` |
| Cursor | `.cursor/skills/<skill>/` |
| OpenCode | `.opencode/skills/<skill>/` |
| Codex | `.agents/skills/<skill>/` |
| Gemini CLI | `.agents/skills/<skill>/` |
| Pi | `.agents/skills/<skill>/` |
| Kimi | `.agents/skills/<skill>/` |
| Kilo | `.kilocode/skills/<skill>/` |
| Kiro | `.kiro/skills/<skill>/` |
| Antigravity | `.agent/skills/<skill>/` |
| Devin | `.devin/skills/<skill>/` |
| Qoder | `.qoder/skills/<skill>/` |
| Codebuddy | `.codebuddy/skills/<skill>/` |
| Copilot | `.github/skills/<skill>/` |
| Droid | `.factory/skills/<skill>/` |
| Reasonix | `.reasonix/skills/<skill>/` |
| ZCode | `.zcode/skills/<skill>/` |
| Trae | `.trae/skills/<skill>/` |
| OMP | `.omp/skills/<skill>/` |
| Grok | `.grok/skills/<skill>/` |
| Snow | `.snow/skills/<skill>/` |

Codex, Gemini CLI, Pi and Kimi share the `.agents/skills/` root (the upstream Agent Skills workspace alias). Their collectors are required to emit byte-identical content for every file more than one of them writes there.

One description, two consumers:

1. `trellis init` → `configurePlatform(platformId, cwd)` → `writeTemplateMap(cwd, collect<Platform>Templates())`. For 18 of the 21 platforms the registry entry in `configurators/index.ts` is literally `fromTemplates(collect<Platform>Templates)`, which *is* that composition. Claude Code, Codex and ZCode spell out a `configure` of their own, each for work a `Map<path, content>` cannot express (an opt-in `--with-statusline` flag, an intentionally empty `.codex/skills/` directory, a one-shot console notice) — none of them restates the file list.
2. `trellis update` → `collectPlatformTemplates(platformId)` (in `configurators/index.ts`) → the same map, used to detect drift and to populate `.trellis/.template-hashes.json`.

Because both consumers read the one description, init and update cannot disagree about which files a bundled skill produces.
