## Current Rules

- `.trellis/workflow.md` is the runtime semantic source for the current project, but its durable authoring source depends on ownership. When Skill-Garden manages a section, change the owning Patch and workflow owner instead of editing only the deployed file.
- `.trellis/config.yaml` remains the project configuration entry point. Flower-managed keys must be traced through `.flower/state.json` before editing; unrelated project-local keys retain the native Trellis behavior.
- `.trellis/spec/`, `.trellis/tasks/`, and `.trellis/workspace/` retain their native task, convention, and deliberate-journal roles unless Plugin state explicitly claims a target within them.
- `.trellis/.template-hashes.json` describes Trellis template ownership. It does not supersede Flower Plugin ownership recorded in `.flower/plugin-lock.json` and `.flower/state.json`.
- `.trellis/agents/{check,implement}.md` remain platform-agnostic channel runtime definitions. Per-platform agent files do not change channel-runtime worker behavior.
- `~/.trellis/channels/<project>/<channel>/events.jsonl` remains the user-owned channel event store; raw platform conversation logs remain local and are queried through `trellis mem`.
- Upstream bundled skills are still distributed by Trellis. Skill-Garden may then apply declared Patches to those deployed copies, and Flower may project additional managed skills or shared common content.
- Platform settings/config files decide which hooks, agents, skills, commands, prompts, and workflows execute. Reasonix continues to encode behavior in skill frontmatter rather than a settings file.
- Discover the active enhanced capability set from the local skill roots, `.trellis/workflow.md`, the selected Bundle catalog when source is available, and `.flower/state.json`; do not maintain a second fixed Skill-Garden skill inventory here.
