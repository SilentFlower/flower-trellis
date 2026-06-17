# 按 Wave 排序版本 Task 创建实施计划

## Implementation Checklist

- [x] 确认 slug 命名策略：采用 `<version>-wNN-tNN-<task-slug>`。
- [x] 更新 `.agents/skills/trellis-plan-version/SKILL.md`，加入“Task 创建顺序”输出和 wave 连续排序规则。
- [x] 更新 `.agents/skills/trellis-extract-prd/SKILL.md`，加入批量创建按顺序执行和 wave-aware slug 规范。
- [x] 更新 `.agents/skills/trellis-verify-task/SKILL.md`，加入版本规划顺序与实际目录排序校验。
- [x] 同步 `.claude/skills/` 同名 skill。
- [x] 同步 `enhancements/0.6/` 的 `.agents` 与 `.claude` 同名 skill。
- [x] 同步 `vendor/skill-garden/.trellis/0.6/` 的 `.agents` 与 `.claude` 同名 skill。
- [x] 检查 0.6 副本一致性。
- [x] 运行任务校验和 diff 空白检查。

## Validation Commands

```bash
python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-17-wave-sorted-task-generation
git diff --check
git -C vendor/skill-garden diff --check
```

副本一致性检查：

```bash
diff -u .agents/skills/trellis-plan-version/SKILL.md enhancements/0.6/.agents/skills/trellis-plan-version/SKILL.md
diff -u .agents/skills/trellis-extract-prd/SKILL.md enhancements/0.6/.agents/skills/trellis-extract-prd/SKILL.md
diff -u .agents/skills/trellis-verify-task/SKILL.md enhancements/0.6/.agents/skills/trellis-verify-task/SKILL.md
```

## Validation Results

- `git diff --check`：通过。
- `git -C vendor/skill-garden diff --check`：通过。
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`：通过。
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-17-wave-sorted-task-generation`：通过。
- `.agents` / `.claude` / `enhancements/0.6` / `vendor/skill-garden/.trellis/0.6` 对应 skill 副本一致性 diff：通过。
- `node scripts/check-snapshot.mjs`：失败，原因是 `enhancements/` 存在本任务产生的未提交快照改动；这是发布前门禁预期行为，提交快照后再运行应通过。
- Phase 3.1 check-all：通过；确认 0.5 副本、`task.py`、`task_store.py` 未被修改。

## Risk Points

- 多份 skill 副本必须保持一致，否则发布快照和本地使用会漂移。
- slug 规范不能要求用户把日期写进 `--slug`，因为 `task.py create` 已经自动添加日期前缀。
- 校验文案要区分“版本规划缺少创建顺序”和“实际 task 目录已经排序不连续”，避免把可修复规划缺口误报成不可恢复错误。

## Review Gate

slug 命名策略已确认。进入实现前仍需按 Trellis Phase 1.4 启动任务，并通过实现路由选择执行模式。
