# Brief — 修复 Skill-Garden 升级平台投影污染

## Goal

- 修复 `flower-trellis update` 重放 `flower/skill-garden` 时复用污染 `.flower/state.json.platforms`，导致未启用的 Gemini/ZCode 平台文件被投影的问题。

## Scope

- 在升级重放内置 `flower/skill-garden` 时，从当前 Trellis 项目真实启用平台推导 Plugin 平台集合。
- 将 Trellis 平台 ID 映射到 Plugin 平台 ID，例如 `claude-code` -> `claude`，`codex` -> `codex`。
- 让正常 Plugin lifecycle 根据重算后的平台集合清理旧 state 中错误管理的 `.gemini/.zcode` check-all agent。
- 增加回归测试覆盖污染 state 被纠正、错误平台文件被清理或不再生成。

## Non-Goals

- 不改变用户显式执行 `flower-trellis plugin add/update --platform ...` 的语义。
- 不新增独立手写清理脚本。
- 不修改上一轮已完成的 untracked/push 任务实现。

## Key Decisions

- 升级重放时以 Trellis 当前项目配置作为平台事实来源，而不是以旧 `.flower/state.json` 作为事实来源。
- 清理错误文件通过现有 Plugin projection、transaction、state/hash 机制完成。

## Key Context

- `src/commands/update.js` 当前重放 Plugin 时未传显式 `--platform`。
- `src/plugin/application-service.js` 在无显式平台时会复用 `previousState.plugins[].platforms`。
- `src/builtin-plugins/skill-garden/content-adapter.js` 会直接按 `platformSelection.platforms` 投影 check-all agent。
- SRM 真实 Trellis 平台检测结果是 `claude-code` 和 `codex`；当前 Flower state 被污染为 `claude/codex/gemini/zcode`。

## Risks / Deferred

- 需要确认获取 Trellis 配置平台的接口在测试环境和本地 CLI 运行环境中都可用。
- 需要避免把该修复扩散到普通 Plugin 命令，防止破坏用户显式平台选择。

## Acceptance

- 旧 `.flower/state.json` 包含 `gemini/zcode`，但项目真实 Trellis 平台只有 Claude/Codex 时，`flower-trellis update` 重放后 state 只保留 Claude/Codex。
- 错误生成的 `.gemini/.zcode` check-all agent 被正常清理或不再生成。
- 用户显式指定 `--platform` 的 Plugin 命令不受影响。
- 相关测试通过。

## Next Step

- 确认 Brief 后运行 `task.py start`，进入实现。
