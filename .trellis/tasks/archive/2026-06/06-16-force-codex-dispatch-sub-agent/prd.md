# 强制 Codex dispatch_mode 为 sub-agent

## Goal

flower-trellis 在 `init` / `update` 叠加强化包时,对已启用 Codex 平台的目标项目强制写入 `.trellis/config.yaml`:

```yaml
codex:
  dispatch_mode: sub-agent
```

目标是让 Codex 项目进入 Trellis sub-agent 工作流,使 `trellis-route` 在 implement / check 阶段可以正常选择并执行 subagent 路径,避免当前默认 inline 注入把 subagent 选项视为不可执行。

## Confirmed Facts

- 当前 `.trellis/config.yaml` 里的 `codex.dispatch_mode` 示例是注释状态,缺失时 Trellis Codex hook 默认按 `inline` 处理。
- Codex 每轮 `<codex-mode>` 来自 `.codex/hooks/inject-workflow-state.py` 的 `_codex_mode_banner(config)`,该函数读取 `.trellis/config.yaml` 的 `codex.dispatch_mode`。
- flower-trellis 的 `init` / `update` 都会调用 `applyEnhancements()`,随后在目标项目存在 `.codex/` 时调用 `applyCodexTweaks(target)`。
- `applyCodexTweaks()` 当前只处理 `.codex/config.toml` 的旧 `multi_agent_v2` 兼容清理,以及合并 `.codex/hooks.json` 的 `SessionStart` hook。
- 因此本功能应落在 `src/lib/codex-tweaks.js` 或其调用链,而不是只手工修改当前仓库的 `.trellis/config.yaml`。

## Requirements

- R1: 当目标项目存在 `.codex/` 时,flower-trellis 的强化叠加阶段必须确保目标 `.trellis/config.yaml` 含有 `codex.dispatch_mode: sub-agent`。
- R2: 该逻辑必须在 `flower-trellis init` 和 `flower-trellis update` 的正常叠加流程中生效。
- R3: 写入必须幂等;重复运行不应产生重复 `codex:` 块、重复 `dispatch_mode` 键或无意义文件变更。
- R4: 逻辑必须保留目标 `.trellis/config.yaml` 的其它配置内容,例如 `packages`、`default_package`、`channel`、hooks 等。
- R5: 仅对 Codex 目标生效;目标没有 `.codex/` 时不得写入 Codex 配置。
- R6: CLI 输出应能让用户知道 Codex 配置已被强制或已经符合要求。
- R7: 评估是否同步加强 `trellis-route` skill 的 Codex inline 语义,避免 agent 在 `<codex-mode>` 为 inline 时自行推断“只能 inline,不能展示 subagent 选项”。
- R8: 本任务同时实施配置强制与 `trellis-route` skill 补强;配置强制解决新安装/升级目标的根因,skill 补强覆盖旧项目或临时 inline 场景的模型误判。
- R9: 同步调整 `in_progress-inline` workflow-state,避免它继续把 Codex inline 描述成 subagent route 的硬禁止条件。

## Acceptance Criteria

- [x] 对存在 `.codex/` 且缺少 `codex` 配置的目标,叠加后 `.trellis/config.yaml` 出现 `codex.dispatch_mode: sub-agent`。
- [x] 对存在 `.codex/` 且已有 `codex.dispatch_mode: inline` 的目标,叠加后 `dispatch_mode` 变为 `sub-agent`。
- [x] 对存在 `.codex/` 且已有 `codex` 其它键的目标,叠加后保留其它键并只设置 / 更新 `dispatch_mode`。
- [x] 对不存在 `.codex/` 的目标,叠加后不新增 `codex` 配置。
- [x] 重复执行同一叠加流程不会继续修改文件。
- [x] `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done` 通过。

## Decisions

- D1: “强制”明确覆盖用户已有的 `codex.dispatch_mode: inline`,将其改为 `sub-agent`。
- D2: 同时修改 `trellis-route` skill,明确 Codex inline 只是默认模式,不是 route 选项裁剪器;`trellis-route` 仍应读取配置或展示 inline/subagent 选项。
- D3: 不修改 `<codex-mode>` hook 本身;通过配置强制让新目标进入 sub-agent 分支,并通过 workflow-state / route skill 文案处理旧 inline 场景。

## Out of Scope

- 不修改 Codex hook 的 `<codex-mode>` 文案。
- 不调整非 Codex 平台行为。
