# Trellis Push 输出模板分层实施计划

## 1. 准备

1. 读取本任务 `prd.md`、`design.md`、`implement.md` 和匹配 spec。
2. 重新确认父仓 `beta` 没有独有提交且仍可从当前 `main` fast-forward；然后执行 `git switch beta` 与 `git merge --ff-only main`。关系变化时停止，禁止 force/reset。
3. 核对 Flower 父仓 `beta` 与 `vendor/skill-garden` 现有 `beta` 的 HEAD、dirty/staged 状态，保留计划外变更。
4. 重新比较 canonical `.agents` / `.claude` 的 `trellis-push`，确认实现前内容一致。

## 2. 修改 Canonical Skill

1. 在 Skill Garden `.agents/skills/trellis-push/references/` 新增 `output-templates.md`：
   - 移入现有 Step 3 计划 Markdown 模板。
   - 移入计划与结果共用展示规则。
   - 移入现有 Step 6 结果 Markdown 模板和 untracked 展示替换规则。
   - 保持现有字段、顺序、条件小节、文件阈值和确认文案。
2. 精简 `.agents/skills/trellis-push/SKILL.md`：
   - Step 3 保留确认门、单次确认和计划漂移语义。
   - 明确用户可见计划前即时读取 reference；缺失时阻塞。
   - 保留 auto-loop 内部逐仓执行数据语义，并明确它不渲染交互计划、不再次确认。
   - Step 6 保留完成/部分完成/失败、任务进度和恢复语义。
   - 明确用户可见结果前再次即时读取 reference；auto-loop 内部结果交给调用方记录，不渲染交互结果。
3. 将 `.agents` 变更同步到 canonical `.claude` 对应目录，确保内容一致。

## 3. 更新静态契约测试

1. 更新 `test/js/update-spec-auto-decision.test.js`：
   - 读取 `trellis-push/references/output-templates.md`。
   - 从 reference 校验 `### 完成链证据` 和风险展示规则。
   - 从主 Skill 校验计划/结果输出前即时读取、缺失阻塞。
2. 更新 `test/js/workflow-gate-ownership.test.js`：
   - 保留现有动态多仓、retained、Step 5 和失败恢复断言。
   - 增加 auto-loop 内部不渲染交互式计划/结果、不要求再次确认的断言。
   - 校验 canonical `.agents` / `.claude` 的主 Skill 与 reference 均一致。
3. 不修改 runner 或 Auto-Loop Skill，除非测试发现现有文字与已确认边界直接矛盾；若发生，先回到规划说明原因。

## 4. 同步 Flower 产物

1. canonical 变更验证通过后，由最终多仓提交链先提交 Skill Garden。
2. 在 Flower 父仓运行 `npm run sync`，生成 `enhancements/0.6` 和更新 `enhancements/MANIFEST.json.sourceCommit`。
3. 通过项目现有 Skill Garden/Flower 更新路径刷新当前 `.agents` / `.claude` dogfood 副本，或按现有受版本控制同步入口执行等价确定性更新。
4. 比较 canonical、enhancements 和 dogfood 的主 Skill/reference，确认无内容漂移。

## 5. 验证

定向验证：

```bash
node --test test/js/update-spec-auto-decision.test.js test/js/workflow-gate-ownership.test.js test/js/output-template-contract.test.js
node scripts/check-output-templates.mjs
```

完整验证：

```bash
npm test
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs
git -C vendor/skill-garden diff --check
git diff --check
```

反向契约检查：

- 主 `SKILL.md` 不再包含完整 `## Trellis Push 计划` / `## Trellis Push 结果` 模板块。
- reference 同时包含两个模板，且输出模板扫描器确实扫描到该文件。
- 主 Skill 仍包含 `auto-loop 内部 commit-only`、动态执行链、Step 5 跳过和失败恢复语义。
- `trellis-auto-loop/SKILL.md` 与 `auto_loop.py` 无计划外变化。
- canonical `.agents` / `.claude`、enhancements 与 dogfood 副本一致。
- Flower 父仓当前分支为 `beta`，其任务基线包含确认时的 `main` HEAD，且没有使用 force/reset 改写历史。

## 6. 完成链

1. 通过 `trellis-check-all` 做最终全范围检查。
2. 运行 `trellis-update-spec`，只在形成新的稳定项目约定时更新 spec；纯文件搬迁不重复记录。
3. 使用 `trellis-push` 展示精确多仓计划，用户确认后提交 Skill Garden、运行确定性同步并提交 Flower 父仓。
4. 不自动运行 `trellis-finish-work`；等待用户显式要求归档。

## 7. 回滚

- 把计划、结果模板和展示规则移回 `SKILL.md` 原位置。
- 删除四个层级中的 `references/output-templates.md` 并重新同步。
- 恢复测试从主 Skill 读取模板字段。
- 不修改 Git 历史、不撤销其它任务或用户变更。
