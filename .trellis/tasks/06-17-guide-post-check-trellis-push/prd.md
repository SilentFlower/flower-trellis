# 引导 post-check 后使用 trellis-push

## Goal

在 flower-trellis 的 Skill-Garden 0.6 注入源里，为 post-check 停止点增加明确引导：当检查完成并按规则停止报告时，提示下一步应进入 Phase 3.4，并使用 `trellis-push` 完成提交/推送或 commit-only 操作，而不是让用户只看到“不会自动提交或 finish-work”。

注入文案必须保持英文，当前项目 `.trellis/workflow.md` 只作为注入结果验证目标，不能作为唯一修改目标。

## Confirmed Facts

- `src/lib/workflow-inject.js` 从 `enhancements/<variant>/overrides/workflow.md` 和 `enhancements/<variant>/overrides/workflow-states/*.md` 读取注入内容，再写入目标项目 `.trellis/workflow.md`。
- `enhancements/` 是发布快照，由 `scripts/sync-enhancements.mjs` 从 `vendor/skill-garden/.trellis/` 同步生成。
- 因此本任务的真实修改源头是 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 和相关 `workflow-states/*.md`，并需要同步到 `enhancements/0.6/overrides/*`。
- 当前项目 `.trellis/workflow.md` 的 Skill-Garden override 已定义 `Post-Check Stop Gate`：`trellis-check` / `trellis-check-all` 完成后必须停止并报告，不能自动执行 `/trellis:finish-work` 或归档。
- 同一 override 已定义 `Code Commit Confirmation Gate`：Phase 3.4 的代码提交/推送必须走 `trellis-push`，不能裸跑 `git commit` / `git push`。
- 当前 `workflow-state:in_progress` 和 `workflow-state:in_progress-inline` 只说明 post-check 后停止报告、Phase 3.4 用 `trellis-push`，但缺少面向用户的下一步引导句式。

## Requirements

- post-check 停止规则必须保留：检查完成后仍然停止报告，不自动提交、不自动推送、不自动 `/trellis:finish-work`。
- 注入源和发布快照中的 post-check 报告规则应明确引导用户下一步使用 `trellis-push` 进入 Phase 3.4，覆盖默认推送和 commit-only 两类常见选择。
- 引导不能暗示检查通过后任务已经可以 finish-work；必须说明 finish-work 只在 Phase 3.4 完成且用户明确要求后执行。
- 文案应同时覆盖主 `Post-Check Stop Gate` 和运行时可见的 `workflow-state:in_progress` / `workflow-state:in_progress-inline`，避免 agent 只读状态块时遗漏。
- 注入内容保持英文；不要把 Skill-Garden override 或 workflow-state 注入块翻译成中文。
- 当前项目 `.trellis/workflow.md` 应通过注入/同步验证得到英文结果，不能只手工改当前项目。
- 如调整 Phase 3.4 正文，只做语义同步，不重写 `trellis-push` skill 的执行协议。

## Out of Scope

- 不修改 `trellis-push` skill 本身的提交/推送流程。
- 不新增 CLI 命令或脚本。
- 不改变 route/check 的选择逻辑。
- 不放宽提交确认门禁，不允许未经确认暂存、提交、推送。
- 不把注入文案翻译成中文。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 的 `Post-Check Stop Gate` 明确要求：检查报告停下时，下一步提示用户使用 `trellis-push`。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress*.md` 的可见 guard 都包含 post-check 后的 `trellis-push` 下一步提示。
- [ ] `enhancements/0.6/overrides/*` 与 `vendor/skill-garden/.trellis/0.6/overrides/*` 同步。
- [ ] 当前项目 `.trellis/workflow.md` 通过注入结果验证，相关注入块保持英文。
- [ ] 文案保留“不自动 finish-work / 不自动归档”的约束。
- [ ] 变更后通过轻量文本检查，确认关键短语 `Post-Check Stop Gate`、`trellis-push`、`finish-work` 的关系没有矛盾。

## Notes

- 这是轻量文档/工作流任务，PRD-only 足够；实现前按 Phase 1.4 启动任务即可。
