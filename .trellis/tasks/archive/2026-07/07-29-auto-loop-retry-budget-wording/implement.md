# 修复 auto-loop 重试预算与入口措辞 - Implementation Plan

## Checklist

- [ ] 在 `test/python/test_auto_loop.py` 增加预算回归测试：
  - 连续失败链路应获得 3 次 `run_fix` action。
  - `retry-blocked` 恢复 `retry-budget-exhausted` 时应重置 `attempts.fix_recheck` 并返回 `run_fix`。
- [ ] 在 `test/python/test_auto_loop.py` 增加 task progress 回归测试：
  - `commit_only` 成功记录后，对应 `task.json.status` 仍为 `in_progress`，且 `progress.nextStep` 指向显式 finish/archive 或后续人工流程。
  - blocked 终态会写入 `progress.partialStep` 和 `progress.nextStep`，并能被 `task_progress.py status --task <task> --json` 读取。
- [ ] 在 `test/python/test_auto_loop.py` 增加 runtime tracking 瘦身回归测试：
  - 多次 manifest revision 后，`<run-id>.json` 不含全量 `manifest_revisions`，只保留当前 revision/hash 和 audit 路径。
  - `<run-id>.manifest.jsonl` 包含完整 revision 事件，且 revision/sha256 可追溯。
  - 含旧版 `manifest_revisions` 数组的 runtime 经一次 CLI 写入后被迁移瘦身，且 `status/resume/retry-blocked` 仍可用。
- [ ] 修改 `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`：
  - schema 1 与 schema 2 发出 `run_fix` 前的预算阻断从 `>=` 调整为 `>`。
  - `RECOVERABLE_BLOCK_REASONS` 加入 `retry-budget-exhausted`。
  - `cmd_retry_blocked` 对该 reason 重置 `attempts.fix_recheck`。
  - 新增或复用内部 helper 写入 `task.json.progress`，严格使用 `task_progress.py` 的五字段 schema。
  - 在 `commit_only` 成功和 blocked 终态路径调用 progress 写入；不得修改 task `status`。
  - 新增 runtime audit helper：把 `manifest_revisions` 迁移/追加到 `<run-id>.manifest.jsonl`，主 JSON 只保留当前 manifest 状态和有限摘要。
  - 确保 `_write_state()` 幂等执行 runtime 瘦身，并兼容旧 runtime。
- [ ] 修改 canonical auto-loop skill description，明确执行 `auto_loop.py next` 获取 action。
- [ ] 运行 `npm run sync` 同步 `enhancements/0.6`。
- [ ] 同步当前 dogfood 安装副本的 runner 和 skill 文件。
- [ ] 运行验证命令并检查 diff。

## Validation Commands

```bash
python3 -m unittest discover -s test/python -p 'test_auto_loop.py'
python3 ./.trellis/scripts/task_progress.py status --task .trellis/tasks/<fixture-or-current-task> --json
python3 ./.trellis/scripts/auto_loop.py status --verbose
npm run sync
npm test
node scripts/check-ai-context-budget.mjs
```

## Rollback Points

- runner 行为集中在 `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py` 与同步副本。
- skill 文案集中在 canonical `.agents/.claude` 与同步副本。
- 若 `npm run sync` 产生计划外快照差异，停止并检查 source/snapshot 漂移。
