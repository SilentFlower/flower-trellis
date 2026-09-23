# 实施计划

1. 在 Skill-Garden 0.6 的 `task_lifecycle.py` 增加 NUL 安全的可纳管未跟踪文件枚举 helper。
2. 扩展 reconciliation 批量写入 helper，支持显式精确 pathspec 与 expected fileset，并保留默认行为。
3. 在 `reconcile_legacy_tasks()` 中识别完全未跟踪候选，累计整个任务目录的提交边界；保留其余 dirty guard。
4. 在 `test/python/test_task_lifecycle.py` 增加 planning/completed、混合批次、dirty/mixed guard、候选外状态和幂等回归测试；必要时补中断恢复覆盖。
5. 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的合同和错误矩阵。
6. 运行聚焦 Python 测试。
7. 运行 `npm run sync` 同步 `enhancements/`，生成/检查 compiled targets，并通过 Flower Plugin 生命周期更新 dogfood。
8. 复核权威源、快照、编译目标和 `.trellis/scripts/` 一致性，再执行相关完整检查。

## 验证命令

```bash
node scripts/run-python-tests.mjs test/python/test_task_lifecycle.py
npm run sync
npm run patch:targets
npm run patch:targets:check
npm test
```

## 风险与停止点

- 若完全未跟踪候选的 expected fileset 无法由 Git 以 NUL 安全方式稳定枚举，停止并保留 `candidate-dirty`，不采用文件系统猜测。
- 若 dogfood 更新会混入当前两个任务目录之外的用户变更，停止在更新前并报告精确差异。
- 不执行 push、release 或 tag。
