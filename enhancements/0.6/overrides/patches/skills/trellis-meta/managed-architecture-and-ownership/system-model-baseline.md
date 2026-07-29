## Local System Model

Trellis provides three layers inside a user project:

1. **Workflow layer**: `.trellis/workflow.md` defines phases, routing, next actions, and prompt blocks.
2. **Persistence layer**: `.trellis/tasks/`, `.trellis/spec/`, and `.trellis/workspace/` store tasks, specs, and session memory.
3. **Platform integration layer**: hooks, settings, agents, skills, commands, prompts, and workflows in platform directories connect the Trellis workflow to different AI tools.

All three layers live inside the user project, so an AI can read and modify them directly.
