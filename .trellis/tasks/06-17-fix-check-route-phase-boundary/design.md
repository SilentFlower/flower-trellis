# Design — 修正 2.2/3.1 检查路由边界

## 背景

Trellis upstream 的 Phase 2.2 是实现后的 `trellis-check` 执行点：sub-agent 平台派 `trellis-check`，inline 平台加载 `trellis-check` skill。Phase 3.1 是 Finish 阶段的 final verification。

flower-trellis / skill-garden 在 `da8ffe7b` 中把 2.2 从 `trellis-route(check)` 中移除，并把 check route 绑定到 3.1。这与 upstream 的 2.2 check 执行点冲突：2.2 仍会按原正文执行 check，但缺少 route gate，导致 Codex sub-agent 模式下可能直接派 `trellis-check`。

## 目标语义

Phase 2.1:

- 进入实现前调用 `trellis-route(implement)`。
- inline/subagent 的选择只决定实现执行方式。

Phase 2.2:

- 作为 check 的实际执行点。
- 调用 `trellis-route(check)`，普通入口默认 check-all inline/subagent；用户显式要求轻量检查时走轻量 `trellis-check`。
- 路由选中 subagent 时，主会话可派 `trellis-check` / fallback check-all prompt。

Phase 3.1:

- 作为提交前 final verification gate。
- 默认确认 2.2 已通过，并检查 2.2 之后是否有代码变化。
- 仅在代码变化、用户要求复查、高风险或 2.2 结果缺失时再次执行检查。
- 不作为普通 `trellis-route(check)` 入口。

## 修改范围

- 当前项目 workflow：
  - `.trellis/workflow.md`
- skill-garden 0.6 覆盖源：
  - `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
  - `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
  - `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
  - `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
  - `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- 发布快照：
  - `enhancements/0.6/.agents/skills/trellis-route/SKILL.md`
  - `enhancements/0.6/.claude/skills/trellis-route/SKILL.md`
  - `enhancements/0.6/overrides/workflow.md`
  - `enhancements/0.6/overrides/workflow-states/in_progress.md`
  - `enhancements/0.6/overrides/workflow-states/in_progress-inline.md`
  - `enhancements/MANIFEST.json`
- route skill 副本：
  - `.agents/skills/trellis-route/SKILL.md`
  - `.claude/skills/trellis-route/SKILL.md`

## 非目标

- 不修改 upstream Trellis 正文中 Phase 2.2 的 `Spawn the check sub-agent` 能力。
- 不修改 Codex hook 的 `codex.dispatch_mode` 逻辑。
- 不调整 0.5/old legacy 文本，除非验证发现 0.6 路径仍受其影响。
- 不引入 runtime 状态来记录 2.1/2.2 完成情况。

## 兼容性

该改动恢复到更接近用户历史体验的模型：2.2 是 check route/执行点，3.1 是收尾确认点。已有 `.trellis/.route-prefs.tmp` 中的 `check=...` 仍可用于 2.2。

## 风险

- 若文案只改 hub，不改 state sentinel，hook 每轮注入仍可能误导模型。
- 若只改本地 `.trellis/workflow.md`，后续 `flower-trellis update` 会被快照覆盖回旧语义。
- 若只改 `.agents`，Claude 用户路径仍可能保持旧语义。
- 若只改 `enhancements/` 而不改 `vendor/skill-garden/.trellis` 源，`npm run sync` 会覆盖发布快照中的 route skill 改动。
