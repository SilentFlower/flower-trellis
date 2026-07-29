The default operating scope is local files in the user project:

- `.trellis/`: workflow, config, tasks, spec, workspace, scripts, bundled runtime agents, and runtime state.
- Platform directories: `.claude/`, `.codex/`, `.cursor/`, `.opencode/`, `.kiro/`, `.gemini/`, `.qoder/`, `.codebuddy/`, `.github/`, `.factory/`, `.pi/`, `.reasonix/`, `.kilocode/`, `.agent/`, `.devin/`, and similar directories. Pi additionally exposes a native `trellis_subagent` tool with `single` / `parallel` / `chain` dispatch modes, throttled progress cards, and `isTrellisAgent()` validation on top of the file layout. Reasonix stores both workflow skills and subagent skills as `.reasonix/skills/<name>/SKILL.md`; subagent skills carry `runAs: subagent` frontmatter.
- Shared skill layer: `.agents/skills/`.
- User-owned channel store outside the project tree: `~/.trellis/channels/<project>/<channel>/events.jsonl`.
- Raw platform conversation logs queryable via `trellis mem`: `~/.claude/projects/`, `~/.codex/sessions/`, and `~/.pi/agent/sessions/` (OpenCode adapter degraded for the v0.6 line).

Do not assume the user has the Trellis source repository. Do not default to modifying the global npm install directory or `node_modules` — both `@mindfoldhq/trellis` and `@mindfoldhq/trellis-core` ship as published packages sharing one version and one git tag per release.
