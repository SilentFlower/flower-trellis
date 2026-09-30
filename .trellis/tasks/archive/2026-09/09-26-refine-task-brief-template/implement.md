# Implement — 任务 Brief 栏目收敛

## Execution

- [x] 修改 Skill-Garden Codex/Claude `trellis-task-brief` 作者源的提取规则和模板：保留一句话 `Goal`、收窄 `Scope`，合并 `Context & Decisions`，加入有依据时的 `Technical Overview`，将可选栏目收窄为 `Risks`，并明确栏目去重。
- [x] 更新 `trellis-brainstorm` 的 `summary-shape-content.md` 与 `overrides/conflicts.json`，保留 selector 和 baseline 原文；调整现有 brief 测试断言。
- [x] 运行定向测试和 Patch 冲突检查，审查修改的来源文件及变更边界。
- [x] 执行 `npm run patch:targets` 与 `npm run sync`，核对 compiled targets、`enhancements/0.6` 与作者源一致。
- [x] 对当前项目先做 enhance-only dry-run，确认仅预期受管目标变化，再运行 `node bin/flower-trellis.js update --target . --enhance-only --variant 0.6 --no-update-check` 更新 dogfood。
- [x] 运行 `node --test test/js/brief-preauthorization.test.js`、`npm run patch:targets:check`、`npm test` 和 `git diff --check`；抽查有设计与 PRD-only 两类 brief 的生成规则。
- [x] 按 Phase 2.2 做 Check-All；Phase 3.3 更新 Brief 长期规范，随后进入提交计划。
- [x] 子仓提交并更新 pin 后重跑 `node scripts/check-snapshot.mjs`，核对发布快照的来源提交。

## Verification Evidence

- 定向 brief 测试 4 项通过；Patch 冲突检查 0 error、0 warning；compiled targets 无漂移。
- enhance-only dry-run 与实际更新均报告 4 个目标文件变化；Codex/Claude brief 作者源、快照和 dogfood 逐字节一致。
- `npm test` 通过：JS 613 通过、2 跳过；Python 496 通过、2 跳过；上下文预算与输出模板检查完成。
- Check-All Full 通过，CHK 0、FBK 0；重复 enhance-only dry-run 报告 0 项变化；Brief 长期规范已更新。
- 子仓与父仓已提交并推送；`check-snapshot.mjs` 通过，快照来源提交与子仓 pin 一致，Patch 冲突检查 0 warning。

## Review Gates

- 作者源与 Codex/Claude 副本一致后才生成投影；Patch 编译与冲突断言通过后才更新当前项目。
- Dogfood dry-run 若包含非预期受管路径、任务目录或用户改动，先诊断并收窄，不直接应用。
- 最终检查一句话 `Goal`、改动范围 `Scope` 与其它栏目职责清晰，Brief 栏目与 `trellis-brainstorm` 交接要求一致，规划确认门禁未变化。

## Rollback Point

如同步或 dogfood 更新失败，保留现有任务材料，按回退后的作者源重新生成目标；不手工修补单个受管副本。
