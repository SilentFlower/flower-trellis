# 版本需求拆分与 Wave 规划实施计划

## Implementation Checklist

- [x] 确认最终模型：版本可以拆多个 task，但 task 必须内聚，不要太散。
- [x] 确认 wave 定义：wave 是版本级提测 / 交付批次，用来组织 task。
- [x] 回滚旧方向：不默认碎拆 task，也不强制整个版本只有一个大 task。
- [x] 更新 `prd.md`，明确 cohesive tasks + version waves 的需求。
- [x] 更新 `design.md`，锁定 artifact shape、`task.json.meta` 摘要和 skill 边界。
- [x] 更新 `trellis-plan-version`，让它生成内聚 task 候选和 waves。
- [x] 更新 `trellis-extract-prd`，让单 task PRD 继承版本规划中的 task 边界和 wave 归属。
- [x] 更新 `trellis-verify-task`，让它校验版本需求 -> task -> wave 覆盖和边界一致性。
- [x] 同步 `.agents`、`.claude`、`enhancements/0.6`、`vendor/skill-garden` 副本。
- [x] 运行文本级和脚本级校验，确认没有破坏现有任务生命周期。

## Validation

- `git -C vendor/skill-garden diff --check`
- `git diff --check`
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-15-version-task-waves`
- 副本一致性 diff：
  - `vendor/skill-garden/.trellis/0.6/.agents/skills/*` vs `.agents/skills/*`
  - `vendor/skill-garden/.trellis/0.6/.claude/skills/*` vs `.claude/skills/*`
  - `vendor/skill-garden/.trellis/0.6/*` vs `enhancements/0.6/*`
- `node scripts/check-snapshot.mjs`（若仅因 `enhancements/` 未提交失败，记录为预期发布门禁）

## Validation Results

- `git -C vendor/skill-garden diff --check`：通过。
- `git diff --check`：通过。
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-15-version-task-waves`：通过。
- 副本一致性 diff：通过，vendor、`.agents`、`.claude`、`enhancements/0.6` 对应 skill 内容一致。
- `node scripts/check-snapshot.mjs`：因 `enhancements/` 存在未提交快照改动失败，符合发布前门禁预期；提交快照后可通过该门禁。

## Review Gates

- 用户纠正模型后，先修正规划和实现，不继续旧方向 check。
- 修改完成后重新跑检查；检查后停止报告，不自动 finish-work。
- 提交 / 推送仍必须走 `trellis-push`。

## Rollback Points

- 如果当前模型仍需调整，只改 skill 文档和任务规划文档即可回滚。
- 不涉及 `task.py` 标准字段和状态机，无数据迁移风险。
