# Direct Git 检查后自动续行实施计划

## 实施步骤

1. 更新 Check-All 双平台权威源。
   - 保留普通 Interactive Post-Check Stop Gate。
   - 在同一 Gate owner 内新增 direct Git strict-pass 条件续行；findings/blocked/partial/material risk 仍停止。
   - strict pass 沿用现有标准 Check-All 报告，Check-All 本身不生成 Git 计划。
   - 明确 subagent 结果由主会话使用同一条件分流。

2. 更新 Phase 2.2 与 in-progress state Patch。
   - Phase 2.2 保存完整分流语义。
   - state 只保留普通 stop、direct Git clean continue、auto-loop record+next 的一跳顺序。
   - Hub 不复制条件矩阵。

3. 更新 Update-Spec override。
   - direct Git intent 覆盖普通 Push 与用户主动 `commit-only`。
   - clean Check-All 后同轮进入；`no-op|written` 加载 Push，`needs-review` 停止。

4. 更新 Trellis Push 双平台权威源。
   - Step 0 分开描述 stale/missing Check-All 与 stale/missing spec_update_result。
   - 保留 auto-loop internal commit-only 预授权和所有 Git 安全检查。

5. 更新 code-spec 与回归测试。
   - 补录 direct Git 条件续行、失败停止、复用有效结论和 Git 确认边界。
   - 扩展 `update-spec-auto-decision.test.js`、`workflow-gate-ownership.test.js`、`check-all-smart-depth.test.js`。
   - 必要时补充最终 dogfood/owner reachability 断言，不新增独立 Gate owner。

6. 同步生成物。
   - `npm run sync`
   - 使用 `workflow-enhancement` Bundle 更新当前 dogfood，重复应用验证幂等。
   - `npm run patch:targets`

7. 执行质量验证。

## 验证命令

```bash
node --test \
  test/js/check-all-smart-depth.test.js \
  test/js/update-spec-auto-decision.test.js \
  test/js/workflow-gate-ownership.test.js

npm run sync
node --input-type=module -e "import { applyEnhancements } from './src/lib/apply-enhancements.js'; applyEnhancements(process.cwd(), { variant: '0.6', skills: ['workflow-enhancement'] });"
node --input-type=module -e "import { applyEnhancements } from './src/lib/apply-enhancements.js'; applyEnhancements(process.cwd(), { variant: '0.6', skills: ['workflow-enhancement'] });"
npm run patch:targets
npm test
node scripts/check-ai-context-budget.mjs --strict
git diff --check
git -C vendor/skill-garden diff --check
```

## 场景矩阵

1. direct Push + no current Check-All + strict pass -> 展示检查结果 -> Update-Spec -> Push plan，同轮无“继续”。
2. user commit-only + no current Check-All + strict pass -> 展示检查结果 -> Update-Spec -> commit-only plan，同轮无“继续”。
3. direct Git + Check-All findings/blocked -> 标准报告并停止，无 Git 计划。
4. direct Git + partial verification/material residual risk -> 标准报告并停止，无 Git 计划。
5. direct Git + valid Check-All + missing spec result -> 只跑 Update-Spec。
6. direct Git + valid Check-All + valid spec result -> 直接 Git 计划。
7. ordinary interactive check + clean -> 仍报告并停止。
8. ordinary next/continue after passed check -> Update-Spec -> Push plan。
9. auto-loop check/commit-only -> 仍走 record+next / runner preauthorization。
10. inline/subagent Check-All -> disposition 一致。
11. diff/check/spec intent 变化 -> 旧证据失效，重新进入对应 Gate。

## Review Gates

- Check-All 仍是 Interactive Post-Check Stop Gate 的唯一完整 owner，新增内容只是窄例外。
- direct Git strict-pass 结果仍对用户可见，Push 计划由独立 owner 在其后生成。
- 不新增或维护第二套精简 Check-All 输出模板。
- Push 不执行 Check-All 或 Update-Spec，只验证并路由完成链前置结果。
- Hub/state 不复制完整条件矩阵。
- 不新增 runtime schema、helper、Gate Engine 或持久化状态。
- 最终 Git commit/push 仍需 Trellis Push 唯一确认。

## Rollback Points

- sync 前：恢复 vendor 权威源、spec 和测试。
- sync 后：恢复 vendor 后重新 `npm run sync`。
- dogfood/compiled targets 后：以恢复后的生成命令重建，不手工回退生成文件。
