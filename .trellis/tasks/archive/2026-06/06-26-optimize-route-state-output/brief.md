# Brief — 优化 route_state 输出冗余

## Goal

- 降低 `route_state.py` 命令输出进入 AI 上下文时的 token 噪音，同时保持 route 决策恢复、调试定位和 runtime 兼容性。

## Scope

- 优化 `.agents/skills/trellis-route/scripts/route_state.py` 的默认输出字段。
- 保留或提供可选方式查看 session/path/prefs 等诊断信息。
- 同步检查并更新 `trellis-route/SKILL.md` 中对 helper 输出字段的说明。
- 验证无 active task、active task miss、runtime hit、prefs hit、write、clear-pref 等主要路径。

## Non-Goals

- 不改变 `.trellis/.runtime/sessions/<context-key>.json` 的持久化结构。
- 不改变 route 决策校验语义。
- 不默认修改 npm 包缓存或上游源码。

## Key Context

- 当前 helper 输出通常低于 200 token，但 route 流程会重复进入上下文。
- 现有默认输出包含 `path`、`context_key`、顶层 `task`、`pref_path`、`wrote_runtime/saved_pref` 等诊断字段。
- 候选方向是默认精简输出，并提供类似 `--verbose` 的诊断输出模式。

## Acceptance

- `route_state.py resolve --target implement|check` 的默认输出比当前少返回非必要诊断字段。
- 需要排查 session/path/prefs 时，仍可通过明确方式获得这些诊断信息。
- runtime state 写入内容保持不变，已有 `route_decisions` 数据仍可读取和校验。
- `trellis-route/SKILL.md` 与 helper 实际输出保持一致。
- 主要分支输出保持机器可解析。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `task.py start` 进入实现阶段。
