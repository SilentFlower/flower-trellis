## Local System Model

Native Trellis provides three project-local layers:

1. **Workflow layer**: `.trellis/workflow.md` defines current phases, routing, next actions, and prompt blocks.
2. **Persistence layer**: `.trellis/tasks/`, `.trellis/spec/`, and `.trellis/workspace/` store tasks, specs, and deliberate session records.
3. **Platform integration layer**: hooks, settings, agents, skills, commands, prompts, workflows, channel runtime files, and memory entry points connect Trellis to AI tools.

Flower adds a conditional management layer when a Plugin is declared and locked:

4. **Plugin management layer**: `.flower/plugins.json` records intent, `.flower/plugin-lock.json` records the resolved immutable graph and granted capabilities, and `.flower/state.json` records owned paths, Patch provenance, and resulting hashes. Planning, preflight, transaction, lock, state, rollback, and uninstall are one lifecycle rather than unrelated local edits.

Without matching Plugin state or managed markers, use the native three-layer model. With `flower/skill-garden` ownership, read deployed files to understand current behavior but make durable 0.6 changes through the owning Skill-Garden source and Patch catalog.
