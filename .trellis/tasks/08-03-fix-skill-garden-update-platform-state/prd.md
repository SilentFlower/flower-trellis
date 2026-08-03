# 修复 Skill-Garden 升级平台投影污染

## Goal

`flower-trellis update` 重放 `flower/skill-garden` 时，不应因为既有 `.flower/state.json` 里的污染平台列表，把未启用的 Gemini/ZCode 平台文件重新投影到项目里。

修复后，升级重放应以当前项目真实启用的 Trellis 平台为准，并通过正常 Plugin lifecycle 清理此前错误生成的 `.gemini/.zcode` check-all agent。

## Confirmed Facts

- SRM 的 Trellis 平台检测结果是 `claude-code` 和 `codex`，不是 Gemini/ZCode。
- SRM 当前 `.flower/state.json` 的 `flower/skill-garden.platforms` 包含 `claude/codex/gemini/zcode`。
- `src/commands/update.js` 的 Plugin 重放没有传入显式 `--platform`。
- `src/plugin/application-service.js` 在无显式平台时会复用 `previousState.plugins[].platforms`。
- `src/builtin-plugins/skill-garden/content-adapter.js` 会把 `platformSelection.platforms` 直接用于 check-all agent 投影，因此污染 state 会生成 `.gemini/agents/trellis-check-all.md` 和 `.zcode/agents/trellis-check-all.md`。

## Requirements

- `flower-trellis update` 在重放内置 `flower/skill-garden` 时，必须从当前 Trellis 项目配置推导平台集合，而不是直接继承旧 `.flower/state.json` 的平台集合。
- 平台 ID 需要转换为 Plugin 使用的 ID：例如 Trellis 的 `claude-code` 对应 Plugin 的 `claude`，`codex` 保持 `codex`。
- 当旧 state 中存在当前项目未启用的平台时，升级重放必须能规划并执行对这些 Plugin 管理文件的清理。
- 修复范围只覆盖升级重放链路，不改变用户显式执行 `flower-trellis plugin add/update --platform ...` 时的语义。
- 保持现有 Plugin lifecycle 的写入、事务、回滚、hash/state 记录机制，不增加新的手写清理脚本。

## Acceptance Criteria

- [ ] 有回归测试覆盖：旧 `.flower/state.json` 包含 `gemini/zcode`，但项目真实 Trellis 平台只有 Claude/Codex 时，`flower-trellis update` 重放后 state 只保留 Claude/Codex。
- [ ] 同一回归测试覆盖错误生成的 `.gemini/.zcode` check-all agent 被正常清理或不再生成。
- [ ] 用户显式指定 `--platform` 的 Plugin 命令不受影响。
- [ ] 相关测试通过。

## Notes

- 这是轻量 bug fix，PRD-only 足够；实现前不新增 `design.md`/`implement.md`，除非检查发现影响面扩大。
