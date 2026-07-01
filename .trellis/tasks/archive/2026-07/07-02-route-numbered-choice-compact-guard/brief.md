# Brief — 修复 route 裸数字选择压缩误用

## Goal

- 修复 Trellis route fallback 在上下文压缩后把历史裸数字回复误解释为当前 target 路由选择的问题，同时保留用户直接回复 `1` / `2` / `3` / `4` 的低摩擦体验。

## Scope

- 更新 `trellis-route` 规则，明确裸数字回复仅在当前可见上一条 assistant 消息刚展示同一 target route 选项并等待用户回答时有效。
- 给 `trellis-route` 输出模板增加提示：只有用户在本 route 选项消息之后立即回复裸数字，才可按本 target 解释。
- 更新 workflow hub 的轻量边界说明，明确 compact summary、ordinary summary、SessionStart 摘要、replacement history 或历史用户裸数字永远不是 route evidence，numbered fallback 细节由 `trellis-route` 承载。
- 同步 0.6 强化包源、`enhancements/0.6` 快照和当前 dogfood 安装副本。
- 更新 route/helper 规范，记录 compact 后历史 `1` 不能写入新 check route 的回归样例。

## Non-Goals

- 不引入 request token、pending route request、`check 1` 强制格式或 route helper schema 变更。
- 不改变 route 选项数量或用户正常只回复裸数字的交互。
- 不修复 Codex 自身 compact 摘要算法，只在 Trellis 规则和模板层降低误用概率。

## Key Context

- 源文件优先改 `vendor/skill-garden/.trellis/0.6`，再运行 `npm run sync` 生成 `enhancements/0.6`。
- 当前 dogfood 副本也要同步：`.agents/skills/trellis-route/SKILL.md`、`.claude/skills/trellis-route/SKILL.md`、`.trellis/workflow.md`。
- 主要规范：`.trellis/spec/flower-trellis/cli/enhancements-model.md`、`.trellis/spec/flower-trellis/cli/config-and-state.md`。
- 风险点是多份副本漂移，以及文案过长导致 route skill 负担增加。

## Acceptance

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md` 和 `.claude` 对应副本包含裸数字有效性规则与输出模板提醒。
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 保留轻量提醒；workflow-state 不重复裸数字细节。
- `npm run sync` 后 `enhancements/0.6` 与 `vendor/skill-garden/.trellis/0.6` 对应文件一致。
- 当前项目 route skill、workflow 和 workflow-state 覆盖副本与新规则一致。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md` 记录该回归样例和验证要求。
- `git diff --check` 与相关 `cmp -s` 一致性检查通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `task.py start`，进入 Phase 2.1 route implement。
