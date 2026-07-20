<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# Project Instructions

## Language Boundaries

- 用户沟通、项目自有源码中新写的维护性注释使用中文。
- Patch、模板和生成载荷必须继承目标文件的语言与风格。
- `content.*`、`selector.*`、`baseline-*` 属于目标内容或匹配材料，不受“代码注释必须使用中文”规则约束。
- `selector.*` 和 `baseline-*` 必须逐字保留目标原文；`content.*` 注入英文目标时使用英文，注入中文目标时使用中文。
- 本节规则优先于通用的代码注释语言要求。
