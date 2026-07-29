# 实施计划：优化 trellis-push 检查门禁与意图识别

## Preconditions

- 当前任务已完成 planning review 并进入 `in_progress`。
- 实现范围以已确认的 `brief.md` 为准，不扩大到 Flower self-update 或 `.flower/` 本地状态。
- 上一轮未确认草稿 diff 已按用户要求先回退；后续实现以当前规划方向重新做。

## Implementation Checklist

1. 已完成：回退 `feat(0.6): 允许 Push 显式跳过 Check-All`，保留 `update -y` 修复。
2. 已完成：根据最终策略更新 `prd.md`，完成 PRD convergence pass。
3. 已完成：更新 `design.md`，固定 owner、正常完成链与显式 Push 分流、Check-All / Update-Spec 状态披露和 intent routing 判断原则。
4. 已完成：更新 `implement.md`，固定实现范围、验证命令和回退点。
5. 已完成：刷新 `brief.md`、展示给用户并获得 planning review 确认。
6. 已完成：用户确认后运行 `task.py start`。
7. 已完成：确认 rollback diff 与任务规划文件为预期基线，`.flower/` 状态不纳入。
8. 已完成：在 Request Triage owner 中补强授权与确定性判断；影响面只作为风险信号，no-task/state 未复制完整规则。
9. 已完成：将 `trellis-push` Step 0 改为完成链证据记录，显式 Push 直接进入 Git 预检，计划展示 Check-All / Update-Spec 状态与风险。
10. 已完成：保持 workflow 正常完成链 `Check-All -> Update-Spec -> Push` 不变，并覆盖 direct Git strict-pass 回归。
11. 已完成：更新 JS/Python 契约测试、Patch conflict assertions 和发布快照一致性测试。
12. 已完成：运行 `npm test`、strict context budget、compiled targets 检查、源/快照/dogfood 一致性与二次应用幂等验证。

## Expected Files

规划后可能涉及：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/intent-routing/request-triage/content.md`
- `vendor/skill-garden/.trellis/0.6/overrides/conflicts.json`（仅当 owner/旧语义断言需要调整）
- `enhancements/0.6/` 中由 `npm run sync` 生成的对应快照
- 当前项目 `.agents/skills/trellis-push/SKILL.md`、`.claude/skills/trellis-push/SKILL.md` 与 `.trellis/workflow.md` 的受管副本（按 dogfood 同步结果决定）
- `test/js/*intent*`、`test/js/update-spec-auto-decision.test.js`、`test/js/workflow-gate-ownership.test.js`
- `.trellis/spec/flower-trellis/cli/*.md`（仅记录最终确认的长期契约）

`src/commands/self-update.js` 与 `src/assets/flower_update_hook.py` 预期不修改；现有 `post_action: run_trellis_push_confirmation` 已足够表达入口，不为 Flower update 新增特例。

## Validation Commands

```bash
npm run sync
npm test
npm run patch:targets:check
node scripts/check-ai-context-budget.mjs
```

具体命令以最终改动范围为准；若实现未修改 Flower CLI 或 Python hook，不运行对应语法检查，并在检查报告说明未纳入原因。

## Rollback Points

- 实现前先保存当前草稿 diff 清单。
- 修改 0.6 skill 时以 `vendor/skill-garden/.trellis/0.6/` 为源；`enhancements/0.6/` 可通过 `npm run sync` 重建。
- `.flower/` 当前未跟踪状态不是本任务草稿的一部分，默认不清理。
