# 修复 route 裸数字选择压缩误用 - 实施计划

## 步骤

1. 更新 `vendor/skill-garden/.trellis/0.6` 源：
   - `trellis-route/SKILL.md` 的 Step 2 和输出模板。
   - `overrides/workflow.md` 的 Routing Gate。
2. 运行 `npm run sync`，生成 `enhancements/0.6` 快照。
3. 同步当前 dogfood 副本：
   - `.agents/skills/trellis-route/SKILL.md`
   - `.claude/skills/trellis-route/SKILL.md`
   - `.trellis/workflow.md`
4. 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md`，记录裸数字压缩误用回归样例和验证要求。
5. 顺手追加最小 finish-work auto-push 优化：
   - `trellis-push` snapshot 记录 `push_mode`。
   - `trellis-finish-work` 根据 `push_mode=commit-only` 决定是否跳过归档 / journal 后的自动 push。
6. 验证：
   - `git diff --check`
   - `cmp -s` 验证 `.agents` 与 `.claude` route skill 副本一致。
   - `cmp -s` 验证 `.agents` 与 `.claude` trellis-push 副本一致。
   - `cmp -s` 验证 `vendor` 与 `enhancements/0.6` 对应源/快照一致。
   - 复核 `rg` 搜索，确认 workflow hub 只有轻量提醒，route skill 承载 numbered fallback 细节，workflow-state 不重复该细节。

## 检查重点

- 不改变用户只回复 `1` 的正常交互。
- 不把 compact summary / ordinary summary / replacement history 的裸数字当 route evidence。
- 不修改 `route_state.py` schema。
