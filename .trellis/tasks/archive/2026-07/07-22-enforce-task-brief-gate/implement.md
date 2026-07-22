# Implement — 修复 Trellis brief 确认门禁绕过

## Checklist

1. 更新 Skill-Garden Workflow Hub：
   - 将 `Task Brief Handoff` 前移到高频保留区域。
   - 补充“早期实现意向不等于最终 planning review”的短规则。
2. 新增 Phase 1.4 Workflow Patch：
   - 使用 0.6.5 section baseline。
   - 替换为 `trellis-task-brief → 展示 → 停止等待 → 后续确认才 start` 的自包含流程。
3. 新增 `trellis-brainstorm` Planning Handoff Patch：
   - 覆盖所有已支持平台的 brainstorm skill 路径。
   - 在 Quality Bar 后加入明确的 brief handoff 和当前回合停止语义。
4. 新增 `task.py` start guard Patch：
   - 只对 `status=planning` 生效。
   - 在任何 active pointer、status 和 hook 副作用前检查 brief 缺失/过期。
   - 保留 in_progress 任务重新绑定和 degraded mode 行为。
5. 更新 `intent-routing` Bundle 和 `conflicts.json`：
   - 登记三项新 Patch。
   - 增加 Phase 1.4、brainstorm、task.py 最终 required-literal 断言。
6. 扩展 Patch 测试 fixture：
   - JS `apply-enhancements` 覆盖最终语义、provenance 与幂等。
   - Python Patch parity 覆盖新 operation、selector 漂移和零写入。
7. 新增 task start runtime 单测：
   - 缺失 brief、PRD/design/implement 过期、有效 brief、in_progress rebind、degraded mode。
8. 运行 `npm run sync` 更新 `enhancements/0.6` 和 manifest。
9. 对当前仓库运行 enhance-only dogfood update，核对 workflow、brainstorm skill、task.py 与快照一致。
10. 运行完整验证并检查实际 diff、上下文预算和 Patch 冲突报告。

## Validation Commands

```bash
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
python3 -m unittest discover -s test/python -p 'test_task_start_brief_gate.py'
node scripts/check-patch-conflicts.mjs
npm run sync
node bin/flower-trellis.js update --target . --enhance-only --variant 0.6 --no-update-check
python3 ./.trellis/scripts/get_context.py --mode phase --step 1.4
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
npm test
git diff --check
```

## Consistency Checks

```bash
diff -ru vendor/skill-garden/.trellis/0.6/overrides enhancements/0.6/overrides
diff -ru vendor/skill-garden/.trellis/0.6/scripts enhancements/0.6/scripts
rg -n "Task Brief Handoff|Planning Handoff|brief.md" \
  .trellis/workflow.md \
  .agents/skills/trellis-brainstorm/SKILL.md \
  .trellis/scripts/task.py
```

## Risk Files

- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/hub/content.md`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/**/patch.json`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-brainstorm/**`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/scripts/**`
- `vendor/skill-garden/.trellis/0.6/overrides/bundles/intent-routing.json`
- `vendor/skill-garden/.trellis/0.6/overrides/conflicts.json`
- `enhancements/0.6/**`
- `.trellis/workflow.md`
- `.agents/skills/trellis-brainstorm/SKILL.md`
- `.trellis/scripts/task.py`
- `test/js/apply-enhancements.test.js`
- `test/python/test_skill_garden_patches.py`
- `test/python/test_task_start_brief_gate.py`

## Review Gates

- [ ] `prd.md` 已完成 convergence，无 open question。
- [ ] `design.md`、`implement.md` 与真实 Patch/脚本结构一致。
- [ ] `implement.jsonl`、`check.jsonl` 均含真实 spec 条目。
- [ ] `trellis-task-brief` 已基于最新三件套生成并在对话完整展示。
- [ ] 用户确认 planning artifacts 和 brief 后才运行 `task.py start`。
- [ ] 进入 Phase 2 后先执行 `trellis-route(target=implement)`。

## Rollback Points

- 新 Patch 尚未加入 Bundle：删除未引用 Patch 目录即可。
- 已加入 Bundle 但未同步：回退 vendor 改动，不运行 `npm run sync`。
- 已同步快照：同时回退 vendor 与 enhancements，重新执行一致性检查。
- 已应用 dogfood：用回退后的快照再次运行 enhance-only update，禁止手工只改 `.trellis` 最终副本。
