# 修复 route 裸数字选择压缩误用

## Goal

修复 Trellis route fallback 在上下文压缩后把历史裸数字回复误解释为当前 target 路由选择的问题，同时保留用户直接回复 `1` / `2` / `3` / `4` 的低摩擦交互体验。

本次只强化规则和模板文案，不引入 request token、pending route request 或要求用户回复 `check 1` 这类更重交互。

## Background

- 事故现象：check route helper 已返回 miss，压缩摘要也写明 check route 未决，但恢复后的 agent 把更早 implement 阶段的裸数字 `1` 当成当前 check 选择，写入了 `check-all-inline`。
- 根因：裸数字选择仍由模型从自然语言上下文里解释；压缩摘要、普通 summary 或 replacement history 里的历史数字容易跨 target 误用。
- 现有规则已声明 compact summary 不能作为 route evidence，但缺少对“裸数字回复只在紧邻 route 提问时有效”的明确约束，也缺少输出模板提醒。

## Requirements

- R1：更新 `trellis-route` 规则，明确裸数字回复仅在“当前可见上一条 assistant 消息刚展示同一个 target 的 route 选项并等待用户回答”时有效。
- R2：更新 `trellis-route` 输出模板，加入提示：只有用户在本 route 选项消息之后立即回复裸数字，才可按本 target 解释。
- R3：更新 workflow hub 的轻量边界说明，明确 compact summary、ordinary summary、SessionStart 摘要、replacement history 或历史用户裸数字永远不是 route evidence，并把 numbered fallback 的详细有效性留给 `trellis-route`。
- R4：保留现有用户体验：正常 route 提问后，用户仍可只回复 `1` / `2` / `3` / `4`。
- R5：不新增复杂状态机制：不引入 request token、pending route request、`check 1` 强制格式或 helper 写入 schema 变更。
- R6：同步 0.6 强化包源、发布快照和当前 dogfood 安装副本，避免后续 `npm run sync` 或本地使用出现漂移。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md` 和 `.claude` 对应副本包含裸数字有效性规则与输出模板提醒。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 保留轻量提醒，说明摘要/历史裸数字不能作为 route evidence，numbered fallback 有效性由 `trellis-route` 负责。
- [ ] `npm run sync` 后 `enhancements/0.6` 与 `vendor/skill-garden/.trellis/0.6` 对应文件一致。
- [ ] 当前项目 `.agents/skills/trellis-route/SKILL.md`、`.claude/skills/trellis-route/SKILL.md` 和 `.trellis/workflow.md` 与新规则一致；workflow-state 不重复承载裸数字细节。
- [ ] 回归说明写入 `.trellis/spec/flower-trellis/cli/enhancements-model.md`：compact 后历史 `1` 不能写入新的 check route；必须重新展示选项并等待紧邻回复。
- [ ] 静态检查通过：`git diff --check`，相关副本 `cmp -s` 一致性检查通过。

## Out Of Scope

- 不改变 route helper 的持久化 schema。
- 不改变 route 选项数量或用户可见编号。
- 不修复 Codex 自身 compact 摘要算法，只在 Trellis 规则和模板层降低误用概率。
