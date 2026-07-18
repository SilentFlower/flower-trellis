# Implementation Plan

## Step 1: Autonomous Update-Spec Override

- [ ] 新增 vendor 0.6 `overrides/skills/trellis-update-spec.md`。
- [ ] 定义 `no-op|written|needs-review`、证据优先级、用户 skip、允许路径、最小变更原则和自校验。
- [ ] 保留上游七段式 code-spec 规则，覆盖其 interactive 决策卡点。

验证：

```bash
rg -n "no-op|written|needs-review|\.trellis/spec|git diff --check" \
  vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-update-spec.md
```

## Step 2: Post-Check Resume Chain

- [ ] 保留 vendor agents/claude Check-All 的现有 interactive stop gate，不在通过后自动运行 Update-Spec。
- [ ] 更新 workflow hub：用户在 passed Check-All 后表达 next/continue 时，同一轮运行 Update-Spec；
  no-op/written 同一轮继续 Trellis Push，needs-review 才停止。
- [ ] 两个 in-progress state 各保留一句短 guard。
- [ ] 增加 Push 前置兜底：passed Check-All 后直接要求 push 且缺 Update-Spec outcome 时先补跑。
- [ ] 保留 Check-All audit-only、修复范围和 Trellis Push 格式所有权。

验证：

```bash
rg -n "Interactive Post-Check Stop Gate|next|continue|no-op|written|needs-review|trellis-push" \
  vendor/skill-garden/.trellis/0.6/overrides/workflow.md
rg -n "Interactive Post-Check Stop Gate" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md
```

## Step 3: Auto-Loop Mapping

- [ ] 更新 agents/claude auto-loop skill 的 `run_spec_update` 结果映射。
- [ ] 更新 runner `run_spec_update` instruction，不改 action/step/schema。
- [ ] no-op/written -> record ok + next；needs-review -> blocked。

验证：

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
rg -n "spec-needs-review|no-op|written" \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md \
  vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
```

## Step 4: Override Installation And Aliases

- [ ] 扩展 `src/lib/apply-enhancements.js` 的 skill override 精细安装 gate。
- [ ] 扩展 `src/lib/skill-override-inject.js` aliases。
- [ ] 扩展 skill-garden `install.sh` 同名 aliases。
- [ ] 更新 vendor README 当前 override 列表。

验证：

```bash
node --check src/lib/apply-enhancements.js
node --check src/lib/skill-override-inject.js
bash -n vendor/skill-garden/scripts/install.sh
```

## Step 5: Regression Tests

- [ ] 新增 Update-Spec 静态契约、Check-All stop 保留、resume-chain 与 Push 前置门禁测试。
- [ ] 扩展 JS apply fixture，覆盖全装、精细安装三个别名、缺目标和幂等。
- [ ] 扩展 Python 独立安装测试，覆盖 agents/claude 注入一致性。
- [ ] 断言 hub/state 不包含详细结果矩阵或 runner 参数。

验证：

```bash
node --test test/js/*.test.js
python3 -m unittest discover -s test/python -p 'test_*.py'
```

## Step 6: Snapshot And Dogfood

- [ ] `npm run sync` 重建 enhancements。
- [ ] 对当前项目运行 `update --enhance-only --no-update-check`。
- [ ] 对比 vendor/snapshot/dogfood Update-Spec override 和 workflow。
- [ ] 重复 update，确认 diff hash 不变。
- [ ] 确认 0.5/old 无漂移。

## Step 7: Spec And Full Verification

- [ ] 更新 `enhancements-model.md` 的 Phase 3.3 自动决策契约。
- [ ] 更新 `ai-context-budget.md` 的 gate ownership 和实际基线。
- [ ] 运行 npm test、strict budget、JS/Python/Bash 语法、diff check、snapshot check。
- [ ] Check-All full 复核后验证先停止；模拟用户继续后，验证 Update-Spec 的 no-op/written 能在
  同一轮直接到 Trellis Push。

## Risk And Rollback Points

- Update-Spec 误写：严格限制 `.trellis/spec/**`，目标不唯一时 needs-review。
- Resume chain 漏跑 Update-Spec：workflow 强制 next/continue 先跑，Push 前置门禁再次校验 outcome。
- Check pass 提前续行：保留并测试现有 Post-Check Stop Gate，不在用户继续前运行 Update-Spec。
- Spec 写入未检查：skill 内自校验，越界立即回到检查流程。
- 高频 prompt 增长：替换旧 stop 文案，完整矩阵只放 override，不调高预算。
- 分发漂移：vendor source-first，sync 后验证两类 consumer 和 dogfood。
