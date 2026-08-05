# 实施计划

1. [x] 更新 Skill-Garden 0.6 的 `trellis-check-all` `.agents` / `.claude` 源：
   - 在入口职责、核心边界、执行模式和报告输入中加入 `OPT-*`。
   - 在 light/full profile 中加入 fail-closed 分类规则与“OPT 不阻断通过”条件。
   - 在 reporting reference 中定义 `OPT-*` 字段、报告区、修复授权和 strict pass/auto-loop/untracked 处置。
2. [x] 更新路由和专用 audit agent：
   - `trellis-route` 的 inline/subagent 说明和 dispatch prompt 返回 `CHK-*` / `OPT-*` / `DOC-*`。
   - 专用 check-all agent body 明确收集并返回 `OPT-*`，仍禁止写工作区。
3. [x] 更新跨阶段契约：
   - workflow Phase 2.2 将 zero findings 收紧为 zero blocking `CHK-*`，允许合规 `OPT-*`。
   - `trellis-push` 将只有 `OPT-*` 的有效报告识别为通过，避免泛化 `findings` 误阻断。
4. [x] 增加聚焦静态契约测试，至少覆盖：
   - 必修/可选分类先于严重度，`P1 != 必修`、`P2 != 可选`；
   - 只有假设后果的历史 P1 兜底满足准入条件时可重新分类为 `OPT-*`；
   - OPT 四项准入条件和禁止降级清单；
   - 报告 `CHK/OPT/DOC` 分栏及 `修复全部` 边界；
   - optional-only strict pass、auto-loop `ok`、untracked 和 direct Git 行为；
   - route agent、workflow 和 push 文本一致性。
5. [x] 运行 `npm run patch:targets` 更新 Skill-Garden compiled targets，并运行 `npm run patch:targets:check`。
6. [x] 运行 `npm run sync` 更新 `enhancements/0.6/`，再按项目 dogfood 同步链更新 `.agents`、`.claude` 和 `.trellis/workflow.md` 的受管结果。
7. [x] 验证源、快照、compiled targets 和 dogfood 副本一致；运行聚焦测试、`npm test`、`git diff --check` 和 `git -C vendor/skill-garden diff --check`。
8. [x] 最终 Check-All 复核分类没有把真实错误弱化为 `OPT-*`，并确认 0.5/old、route 模式选择、DOC 自动修复和三维检查模型未发生计划外变化。

## 风险文件与回滚点

- `reporting-and-disposition.md` 同时拥有报告、auto-loop、strict pass 和下一步分流，必须整体复核，不能只插入展示区。
- workflow Phase 2.2 和 `trellis-push` 的“findings”措辞可能间接覆盖 OPT，需通过测试锁定“阻断 findings”语义。
- `npm run patch:targets` 会更新 vendor 子仓的 canonical 产物；`npm run sync` 会重建父仓快照，执行前后都要核对双仓 dirty 范围。

## 验证命令

```bash
node --test test/js/check-all-optional-findings.test.js
npm run patch:targets
npm run patch:targets:check
npm run sync
npm test
git diff --check
git -C vendor/skill-garden diff --check
```

双仓提交完成后的 `node scripts/check-snapshot.mjs` 仍按既有 Phase 3.4 顺序执行，不作为实现阶段静态内容修改前的阻塞条件。

## 实施验证记录

- `node --test test/js/check-all-optional-findings.test.js`：5 项通过。
- 受影响聚焦测试：19 项通过。
- `npm test`：完整验证链退出码为 0，其中 Node 测试 409 项通过。
- `npm run patch:targets:check`：通过，无 compiled targets 漂移。
- `npm run sync` 后连续两次 dogfood update：首次更新 22 个目标，第二次更新 0 个目标，幂等性通过。
- 严格上下文预算检查：通过；workflow 和控制上下文总量均低于目标阈值。
- `git diff --check` 与 `git -C vendor/skill-garden diff --check`：通过。
- `node scripts/check-snapshot.mjs`：按预期因 vendor 子仓尚未提交而拒绝；该检查归属 Phase 3.4 双仓提交顺序，不属于本阶段实现失败。
