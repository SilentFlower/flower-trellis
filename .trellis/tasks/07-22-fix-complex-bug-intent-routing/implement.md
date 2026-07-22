# 实施计划

## 实施步骤

1. 以已确认的显式覆盖边界为准复核 `prd.md`、`design.md` 和本实施计划。
2. 修改 vendor workflow hub，加入修复授权与任务规划授权分离、未知范围 BUG 两阶段路由、复杂实现信号。
3. 精简并同步 Request Triage 与 `workflow-state:no_task`，确保高频层不重复完整规则。
4. 更新 JS/Python 回归断言，覆盖最终 workflow 语义、完整 Bundle、真实 catalog preflight 和幂等。
5. 运行 `npm run sync`，核对 vendor 与 `enhancements/0.6` overrides 一致。
6. 同步当前 dogfood `.trellis/workflow.md`，确认 managed marker 与最终文本正确。
7. 运行质量门禁并记录预算变化。

## 验证命令

```bash
git diff --check
npm test
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
npm run sync
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
node --test test/js/apply-enhancements.test.js
```

同步后补充执行 vendor/snapshot 对比和当前 dogfood Patch 预检；具体命令以仓库现有脚本为准，不手工猜测未定义入口。

## 风险与回滚点

- workflow hub 属于高频上下文，文本增长可能推高 Phase summary 与 SessionStart warning；优先替换和去重，不提高预算阈值。
- 规则过严会把小修复全部升级为 task；测试必须同时保留局部低风险 `direct_edit` 能力。
- 只改发布快照会被下次 sync 覆盖；必须坚持 vendor 源优先。
- 当前 dogfood workflow 与发布快照漂移会导致本项目验证和下游行为不一致，检查阶段必须对比。

## Start 前检查

- `prd.md` 已完成收敛且无阻塞问题。
- 用户已审阅 task brief 并确认进入实现。
- `implement.jsonl` 与 `check.jsonl` 均包含真实规范条目。
- 通过 `trellis-route(target=implement)` 决定实现执行方式。
