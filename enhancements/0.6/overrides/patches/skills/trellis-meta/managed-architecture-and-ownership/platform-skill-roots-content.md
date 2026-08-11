## Where Bundled Skills Land Per Platform

A platform's whole file set is described exactly once by `collect<Platform>Templates()` in `packages/cli/src/configurators/<platform>.ts`. `resolveBundledSkills(ctx)` loads the upstream bundled-skill tree, and `collectSkillTemplates(<skillsRoot>, <workflowSkills>, <bundledSkills>)` places it in the platform's `Map<filePath, content>`. `trellis init` writes that map through `writeTemplateMap`; `trellis update` reads the same map through `collectPlatformTemplates(platformId)` for drift detection and `.trellis/.template-hashes.json`.

| Platform | Bundled skill root | Flower ownership note |
| --- | --- | --- |
| Claude Code | `.claude/skills/<skill>/` | Private platform root |
| Cursor | `.cursor/skills/<skill>/` | Private platform root |
| OpenCode | `.opencode/skills/<skill>/` | Private platform root |
| Codex | `.agents/skills/<skill>/` | Shared neutral root |
| Gemini CLI | `.agents/skills/<skill>/` | Shared neutral root |
| Pi Agent | `.agents/skills/<skill>/` | Shared neutral root; `.pi/` keeps prompts, agents, extensions, and settings |
| Kimi Code | `.agents/skills/<skill>/` | Shared neutral root; `.kimi-code/skills/` keeps commands and agent prompts |
| Kilo | `.kilocode/skills/<skill>/` | Private platform root |
| Kiro | `.kiro/skills/<skill>/` | Private platform root |
| Antigravity | `.agent/skills/<skill>/` | Private platform root |
| Devin | `.devin/skills/<skill>/` | Private platform root |
| Qoder | `.qoder/skills/<skill>/` | Private platform root |
| CodeBuddy | `.codebuddy/skills/<skill>/` | Private platform root |
| GitHub Copilot | `.github/skills/<skill>/` | Private platform root |
| Factory Droid | `.factory/skills/<skill>/` | Private platform root |
| Reasonix | `.reasonix/skills/<skill>/` | Private platform root; agent behavior also uses skill frontmatter |
| ZCode | `.zcode/skills/<skill>/` | Private platform root |
| Trae | `.trae/skills/<skill>/` | Private platform root |
| Oh My Pi | `.omp/skills/<skill>/` | Private platform root |
| Grok Build | `.grok/skills/<skill>/` | Private platform root |
| Snow CLI | `.snow/skills/<skill>/` | Private platform root |

The physical roots are the platform-private roots above plus one shared `.agents/skills/` tree. `.pi/skills/` is not a current target, and `.kimi-code/skills/` must not receive a second bundled copy. Codex, Gemini CLI, Pi Agent, and Kimi Code must receive byte-identical neutral content whenever they share a path.

Flower does not maintain a second platform file map. It discovers enabled logical platforms from their native entry points, projects managed additions only to those platforms, and applies declared Skill-Garden Patches after the upstream map exists. A shared physical root is never evidence that every logical consumer is enabled.
