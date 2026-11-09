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

## 本项目 Codex 后台确认演练

仅在用户明确要求演练时启用，当前只支持 Linux/WSL 的 Codex 0.167.0 managed daemon。使用已有 Node 环境，无需安装或注册 MCP；详细步骤见 `docs/codex-background-confirmation.md`。

- 先说明秒数和到期输出的演练文本，再调用 `node scripts/codex-confirmation.mjs wait --seconds <秒数> --message <文本>`。由原生命令工具设置短 `yield_time_ms`（例如 1000），取得后台 session 和 `prepared` 结果后立即用 final 结束当前回合；计时从该回合完成后开始。不要同步轮询倒计时，也不要用阻塞工具等待用户。
- 用户提交任何新人工消息会取消旧等待。用户要求修改时间或文本时，重新发起等待即可替换旧请求；`status` 查询，`cancel` 取消。会话严格取 `CODEX_THREAD_ID`，不得猜测最新会话。
- 收到完整的 `[flower-confirmation:v1:<请求 UUID>]` 内部唤醒时，先调用 `node scripts/codex-confirmation.mjs claim --request <请求 UUID>`。只有 `claimed=true` 才原样输出返回的 `message` 并结束回合；否则将其视为已失效提醒，结束回合，不重复默认动作。普通后台终端的输出或完成通知不构成新的演练触发。
- 演练只输出文本；不能把到期、空回复、失败或内部唤醒当成 Brief 开工、修复、提交、推送的授权。其它人工确认门禁保持原流程。
