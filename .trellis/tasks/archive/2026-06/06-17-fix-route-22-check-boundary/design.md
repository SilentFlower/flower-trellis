# Design — 修正 trellis-route 与 2.2 检查路由边界

## Technical Boundary

本任务是 Trellis 本地强化包和工作流文档级修改，不涉及业务代码。源头应优先修改 `vendor/skill-garden/.trellis/0.6`，再同步当前项目副本和 `enhancements/0.6` 快照。

## Target Semantics

新的路由边界：

- Phase 2.1：实现前调用 `trellis-route(target=implement)`，决定 implement 的 inline/subagent 执行模式。
- Phase 2.2：执行 implement 闭环内质量检查，不单独调用 `trellis-route`。该检查仍可以使用 `trellis-check` skill/agent，但它是实现后的自检与修复循环，不等同于最终 check/check-all 路由。
- Phase 3.1：最终质量验证前调用 `trellis-route(target=check)`，默认走 `check-all inline` / `check-all subagent`；轻量 `trellis-check` 仍仅在用户明确请求时作为隐藏逃生口。

## Text Changes

### trellis-route skill

将 frontmatter description 和正文开头从 `Phase 2.1 / 2.2 / 3.1` 改成 `Phase 2.1 / 3.1`，并补充：

- 2.1 只用于 `target=implement`。
- 3.1 只用于最终 `target=check`。
- 2.2 属于 implement 闭环内质量检查，不是 route 入口。

Step 0 中 `target=check` 的准入条件要避免覆盖 2.2：普通 check 路由应以 Phase 3.1 或用户明确要求最终检查/轻量检查为前提，而不是“已有本轮实现变更”就自动进入 route。

### workflow hub

把 scope 从 `Phase 2.1 / 2.2 / 3.1 dispatch routing` 改为 `Phase 2.1 implement routing and Phase 3.1 check routing`。

把 Routing Gate 从“任何 implement/check agent 或 check skill 运行前都要 route”改为更窄规则：

- implement 执行模式选择前必须 route。
- Phase 3.1 最终 check/check-all 前必须 route。
- Phase 2.2 的实现内检查不单独 route；它沿用当前 implement 闭环执行，并在发现问题时修复后重复。

### workflow-state guards

`in_progress.md` 改为显式三段：

- Phase 2.1：先 `trellis-route(implement)`。
- Phase 2.2：执行实现内质量检查；不要把它升级成 `trellis-route(check)`。
- Phase 3.1：先 `trellis-route(check)` 再执行最终 verification。

`in_progress-inline.md` 同步改写，避免 `before checking, route check first` 这种会误伤 2.2 的泛化表述。

## Sync Strategy

1. 修改 `vendor/skill-garden/.trellis/0.6` 源文件。
2. 将 route skill 同步到 `.agents/skills/trellis-route` 和 `.claude/skills/trellis-route`。
3. 将 workflow override 同步到当前 `.trellis/workflow.md` 的已注入 skill-garden hub/state guard。
4. 运行 `npm run sync` 生成 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
5. 检查 `vendor`、当前副本、`enhancements` 之间的 diff。

## Compatibility

`src/lib/workflow-inject.js` 对 0.6 文案是文件驱动的，不需要修改注入算法。它仍会清理旧 block 并注入 `enhancements/0.6/overrides/**` 的新内容。

0.5 / legacy 文案在 `src/lib/legacy-blocks.js`、`vendor/skill-garden/scripts/install.sh` 和 `enhancements/0.5/overrides/trellis-route.md` 中仍会保留旧表述。本任务只修 0.6 主路径，不修改这些旧变体兼容位置。

## Rollback

文档级变更可通过回退相关文件恢复。若 `npm run sync` 已更新快照，回滚时需要同时回滚 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
