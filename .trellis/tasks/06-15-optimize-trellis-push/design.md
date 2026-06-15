# 优化 trellis-push 设计

## Technical Design

本任务采用文档级重构，不新增运行时代码。目标是让 `trellis-push` skill 的执行协议更稳定：

1. **统一阶段结构**
   - Phase 0：读取配置与活动任务上下文。
   - Phase 1：预检并收集所有候选仓库状态。
   - Phase 2：生成一次性执行计划，包含业务提交、push/merge 意图、snapshot 进度草案和父仓 bookkeeping 计划。
   - Phase 3：用户确认后执行暂存、commit、push。
   - Phase 4：按已确认计划执行可选 merge。
   - Phase 5：按已确认 snapshot 草案补齐运行后字段，并提交父仓 `task.json`。
   - Phase 6：输出结果表。

2. **统一提交确认门禁**
   - 在任何 `git add` / commit / push 之前，必须展示每个仓库的具体文件列表和草拟 commit message。
   - 同一份确认计划必须展示 snapshot 进度草案：`completed_steps`、`partial_step`、`next_step`、`notes`。
   - `pushed_commits`、`snapshot_at`、实际分支/commit hash 等运行后才可得的字段，在计划中用“执行成功后补齐”说明。
   - 未识别 dirty 文件必须单列，默认不纳入计划。
   - 用户确认前不得执行暂存。
   - 继续禁止 `git add -A` / `git add .`。

3. **snapshot 合并确认，bookkeeping 分边界执行**
   - snapshot 的语义内容并入统一确认，不再默认二次询问。
   - 业务仓库 commit/push 成功后，按已确认草案写入 `last_push_snapshot`，并补齐实际 commit hash 与时间戳。
   - 父仓 bookkeeping commit/push 只处理目标 `task.json`。
   - 只有在计划变化、用户调整 snapshot、执行失败重试、父仓出现额外 dirty 文件、merge 冲突等情况下，才需要二次确认。

4. **同步边界**
   - 源头改 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md` 与 `.claude` 对应文件。
   - 同步到本项目当前 `.agents` / `.claude` 副本。
   - 运行 `npm run sync` 更新 `enhancements/` 快照和 manifest。

## Compatibility

- 保留现有自然语言语义：默认、commit-only、指定仓库、重新配置、临时目标。
- 保留现有 `last_push_snapshot` 字段 schema。
- snapshot schema 不变，只调整确认时机：执行前确认语义字段，执行后补齐机械字段。
- 不改变 `.trellis/config.yaml` 的 `packages.<name>.merge_target` 配置方式。

## Rollout / Rollback

- Rollout：先改 skill-garden 0.6 源，确认当前副本和快照一致，再做校验。
- Rollback：回退本任务修改的 `trellis-push/SKILL.md`、`enhancements/` 快照和 manifest。
