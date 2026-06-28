# 修正 check 后路由规则

## Goal

修正 Trellis 0.6 / flower-trellis / skill-garden 的 implement-check 循环路由语义：首次进入实现与首次进入检查时仍由 `trellis-route` 决定执行模式；但 check 发现问题后的修复循环不应反复询问模式，也不应在没有有效 check 路由决策时自动降级为 inline check。

## Requirements

- Phase 2.1 首次实现前仍必须走 `trellis-route(implement)`，决定 inline / subagent。
- Phase 2.2 首次检查前仍必须走 `trellis-route(check)`，决定 check-all inline / check-all subagent；轻量 `trellis-check` 仍只在用户明确请求 `light check` / `轻量检查` 时作为隐藏逃生口。
- 当 check 发现问题、用户指出实现有问题、或修复后需要重跑同一轮检查时，应沿用本轮已经选定的 implement/check 执行模式继续闭环，不应再次调用 `trellis-route` 弹出模式选择。
- 如果进入的是新的独立检查阶段，例如提交前复查、check 后又有额外代码变更、风险升高、用户明确说“重新选择 route / 这次用 X / 清除默认”，才允许重新进入 `trellis-route(check)`。
- 不允许在没有有效 check 路由决策或个人默认配置时自动执行 inline check；若 `trellis-route` helper / 交互工具不可用，必须用普通聊天展示同编号选项并等待用户选择。
- Codex inline / sub-agent 上下文只能影响默认执行环境，不能作为绕过 `trellis-route` 或裁剪 check 选项的依据。
- 修改必须覆盖当前项目 `.trellis/workflow.md`、`trellis-route` skill、副本/快照和 skill-garden 0.6 覆盖源，避免后续同步或 update 带回旧语义。
- 保留 post-check stop gate、Phase 3.4 `trellis-push` 门禁、个人 `.trellis/.route-prefs.tmp`、临时覆盖和隐藏轻量 check 规则。

## Acceptance Criteria

- [x] workflow hub 明确区分“首次进入 2.1/2.2 需要 route”和“check 失败后的同轮修复/复查沿用既有路由”。
- [x] `workflow-state:in_progress` 与 `in_progress-inline` 不再引导 check 失败或用户指出问题时重新询问模式。
- [x] `trellis-route` skill 明确禁止在无 check 配置/无用户选择时自动 inline check。
- [x] `trellis-route` skill 明确失败修复闭环沿用最近一次本轮路由，只有新检查阶段或用户显式覆盖才重新选择。
- [x] `.agents`、`.claude`、`enhancements/0.6`、`vendor/skill-garden/.trellis/0.6` 中对应 0.6 文案保持一致。
- [x] 搜索 0.6 主路径时，不再出现“helper 不可用就默认 inline check”或“check 失败后重新 route”含义的文案。
- [x] 运行语法/一致性检查，至少包含 `node --check`、`git diff --check` 和 vendor/enhancements 对应文件 diff。

## Notes

- 已确认历史任务存在方向反复：`06-17-fix-route-22-check-boundary` 曾要求 2.2 不 route，`06-17-fix-check-route-phase-boundary` 又恢复 2.2 route。本任务不再争论 2.2 是否是检查入口，而是补齐“同一轮失败修复不重复问模式”和“无 route 不能自动 inline”的约束。
- 当前 `.trellis/workflow.md`、`enhancements/0.6/overrides/workflow.md`、`workflow-states/in_progress*.md` 仍把 Phase 2.2 写成必须 route check；这解释了重复询问。
- 当前 `trellis-route` 已声明 helper 不可用时不能自行选择，但 workflow/状态块缺少 check 失败闭环复用路由的明确规则，模型容易回到 route 选择。
