# 修正 trellis-route 与 2.2 检查路由边界

## Goal

修正 Trellis 0.6 强化流程中 `trellis-route` 的触发边界：`2.2 Quality check` 属于 implement 闭环内的实现自检，不应被描述为独立进入 `trellis-route(target=check)` 的阶段；`trellis-route` 应只在 Phase 2.1 选择 implement 执行模式，以及 Phase 3.1 选择最终 check/check-all 执行模式时触发。

## Background / Known Context

- 用户指出现有文案把 `Phase 2.1 / 2.2 / 3.1` 都列为 `trellis-route` 入口不准确。
- 当前 `.trellis/workflow.md` 的 skill-garden hub 写着 `Phase 2.1 / 2.2 / 3.1 dispatch routing`，并要求 phase boundary 调用 `trellis-route(implement|check)`。
- 当前 `.trellis/workflow.md` 的 `workflow-state:in_progress` 写着 `At Phase 2.1/2.2/3.1, invoke trellis-route(implement|check) first`。
- 当前 `.trellis/workflow.md` 的 `workflow-state:in_progress-inline` 写着 `before checking, route check first`，这会把 2.2 的实现内检查和 3.1 的最终检查混在一起。
- 当前 `trellis-route` skill 的 `.agents`、`.claude`、`enhancements/0.6`、`vendor/skill-garden/.trellis/0.6` 副本都写着 `Invoked from Phase 2.1 / 2.2 / 3.1`。
- `2.2 Quality check` 的正文仍是实现阶段内的检查：sub-agent 平台派发 `trellis-check` 进行 review/fix；codex-inline 加载 `trellis-check` 做 spec/lint/type/test 检查，发现问题后修复并重复。
- `3.1 Quality verification` 是 finish 阶段最终验证，才适合走 `trellis-route(target=check)` 和 `check-all` 默认路径。

## Requirements

- `trellis-route` 的普通触发边界改为：
  - Phase 2.1：进入实现前选择 `target=implement` 的 inline/subagent 模式。
  - Phase 3.1：进入最终质量验证前选择 `target=check` 的 check-all inline/subagent 模式。
- Phase 2.2 必须被定义为 implement 闭环内部质量检查，不再作为独立 `trellis-route(target=check)` 入口。
- 保留 Phase 2.2 的质量门：实现后仍必须检查、修复、重复检查直到通过。
- 保留 `trellis-route` 的个人偏好、临时覆盖、隐藏轻量 check 逃生口等既有能力；本任务只修正阶段边界，不回退 6 月 15 日的 route 交互优化。
- 修改必须覆盖 skill-garden 注入源、当前项目已注入 workflow、当前平台 skill 副本和发布快照，避免后续 `sync` / `update` 把旧语义带回来。
- 修改后的文案必须避免把“任何 check skill 运行前都要 route”扩大到 Phase 2.2；应明确区分“实现内检查”和“最终 check/check-all 路由”。
- 不应改动 `trellis-push`、task 生命周期、`task.py` 状态机或提交门禁。

## Impact Surface

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`
- `.trellis/workflow.md`
- `enhancements/0.6/.agents/skills/trellis-route/SKILL.md`
- `enhancements/0.6/.claude/skills/trellis-route/SKILL.md`
- `enhancements/0.6/overrides/workflow.md`
- `enhancements/0.6/overrides/workflow-states/in_progress.md`
- `enhancements/0.6/overrides/workflow-states/in_progress-inline.md`
- `enhancements/MANIFEST.json`

## Related / Compatibility Notes

- `src/lib/workflow-inject.js` 主要负责清理旧 skill-garden block 并从 `enhancements/0.6/overrides/**` 注入新文本，当前没有硬编码 0.6 路由文案；通常不需要改。
- `src/lib/legacy-blocks.js` 和 `vendor/skill-garden/scripts/install.sh` 内有 0.5 / legacy 文案 `At Phase 2.1/2.2/3.1...`。这是旧变体兼容路径，本任务不修改。
- `enhancements/0.5/overrides/trellis-route.md` 也保留旧 route 语义，本任务不回改 0.5 变体。
- `.claude/commands/trellis/continue.md` 和 `.agents/skills/trellis-continue/SKILL.md` 把 resume 到 2.2 描述为 `implementation done, not yet checked -> 2.2`，该描述本身正确；只有它是否进一步调用 route 需要与新语义对齐。
- 过去归档任务 `06-15-optimize-trellis-route` 的设计明确写过当时目标是 `Phase 2.1 / 2.2 / 3.1` 路由；本任务是对该决策的修正。

## Acceptance Criteria

- [x] `trellis-route` skill 所有 0.6 副本不再声明从 Phase 2.2 调用。
- [x] skill-garden 0.6 workflow hub 不再把 `2.2` 纳入 dispatch routing scope。
- [x] `workflow-state:in_progress` / `in_progress-inline` 明确：2.1 route implement；2.2 执行实现内质量检查；3.1 route check/check-all。
- [x] 当前项目 `.trellis/workflow.md` 与 `vendor/skill-garden` 源、`.agents`、`.claude`、`enhancements/0.6` 语义一致。
- [x] Phase 2.2 的检查要求仍存在，不能因移除 route 入口而跳过实现后检查。
- [x] `npm run sync` 后发布快照与 `vendor/skill-garden` 源一致，`enhancements/MANIFEST.json` 更新为当前 source commit。
- [x] 运行副本 diff、JS 语法检查、`git diff --check`、`git -C vendor/skill-garden diff --check`。
- [x] 明确记录 0.5 / legacy 文案不在本任务内同步修正。

## Out of Scope

- 不新增 CLI 命令或运行时代码。
- 不改变 `.trellis/.route-prefs.tmp` 的格式。
- 不移除 `trellis-route` 的 subagent/inline 选择能力。
- 不修改 `trellis-push` 的提交确认流程。

## Decisions

- 只修 0.6 主路径；0.5 / legacy 文案不纳入本任务实现范围。
