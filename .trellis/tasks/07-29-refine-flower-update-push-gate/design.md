# 设计：优化 trellis-push 检查门禁与意图识别

## Problem Restatement

当前问题不是 Flower update 的逻辑错误，而是 `trellis-push` 的完成链前置关系把“提交意图”和“质量流程意图”混在了一起：

1. `trellis-push` 曾在缺少有效 Check-All 时先弹 `运行 check-all` / `跳过检查并继续 push`，导致 push 之前多一次确认卡点；回退后又恢复为强制返回 Phase 2.2，两种行为都会截停显式 Push。
2. 用户发起 push 时，有时就是不想经过 Check-All；这种意图不应再被包装成额外风险确认或意图改写要求。
3. 即使移除 Check-All 卡点，当前 Step 0 后续的 Update-Spec 校验仍可能再次截停显式 Push，因此必须一起处理。
4. 用户表达 workflow 体验反馈时，AI 可能把“讨论/设计不适感”当成“明确修复授权”；反过来，若简单规定所有 workflow/hook 改动都必须建任务，又会误伤精确回退等范围已经明确的操作。

## Ownership Boundaries

| 责任 | Owner | 说明 |
| --- | --- | --- |
| 用户自然语言意图分类 | workflow `Request Triage` + `trellis-start` | 判断 `discuss` / `inspect` / `direct_edit` / `task_plan` / `workflow_action`，尤其是设计反馈与跨门禁改造。 |
| Flower 更新确认 | SessionStart update context + Flower CLI | 只负责发现更新、执行受控 self-update、输出结构化结果；不得提交 Git。它只是 `trellis-push` 问题的一个入口场景。 |
| Git 收尾计划 | `trellis-push` | 负责 Check-All / Update-Spec 状态披露、exact files、commit message、Git 安全预检和最终确认。 |
| Check-All 完成链 | Phase 2.2 + `trellis-check-all` | 仍负责普通业务开发完成后的质量检查和 post-check disposition。 |
| Update-Spec 完成链 | Phase 3.3 + `trellis-update-spec` | 仍负责普通业务开发完成后的规范评估和最小必要写入。 |

设计必须避免把完整规则同时写进 hub、state 和 skill。hub 只保留 owner 索引；完整语义放在对应 owner。

## Selected Direction

### Push 请求直接进入 push 计划

当用户发起 `trellis-push` / push / 提交，或 Flower 更新结果要求进入 push confirmation 时，`trellis-push` 不再因为 Check-All 或 Update-Spec 状态停止、二选一、触发补跑，或要求用户改写意图。它直接进入 Git 预检与计划。计划里统一展示完成链证据，例如：

```text
Check-All: 未运行/已失效，本次 push 不自动补跑
Update-Spec: 未运行/已失效，本次 push 不自动评估
```

若已有 Check-All findings/blocked 或 Update-Spec `needs-review`，也进入同一计划的风险区，不再派生第二次确认。最终执行仍需要 `trellis-push` 原有的一次确认：exact files、commit message、保留 dirty、风险、push 动作。

只有 Git 层面的确定性条件可以阻断计划，例如冲突未清零、exact files 无法确定、仓库或 upstream 状态不满足安全执行条件。

优点：显式 Push 始终只有一次用户确认，同时保留完成链审计信息和 Git 安全边界。

风险：用户可能在没有质量检查或规范评估的情况下提交；缓解方式是计划内显式披露，而不是增加新卡点。

### 正常完成链与显式 Push 分流

正常由 workflow 推进的开发收尾保持原顺序：

```text
Check-All -> Update-Spec -> Push
```

用户主动要求 check/check-all 时仍按原流程运行；开发完成后的默认质量流程也不改变。只有当用户已经明确进入 Push，或受控更新结果明确要求生成 push confirmation 时，`trellis-push` 才把两类前置结果视为审计信息。

这个分流把“应该怎样完成开发流程”和“用户现在要求执行 Git 收尾”分开，避免 `trellis-push` 同时承担 Phase 2.2、Phase 3.3 和 Phase 3.4 三个阶段的交互门禁。

## Intent Routing Design

意图分类基于当前请求提供的授权与确定性，不基于领域关键词硬编码：

- “你觉得怎样改”“不舒服”“不认同”“好像不理想”等只表达评价或寻求方案的请求进入 `discuss`，不包含修改授权。
- “检查一下为什么”“看看现状”进入 `inspect`；检查结果不能反向扩张成修复授权。
- 明确要求执行一个范围已知、可逆、无需额外设计决策且可简单验证的修改或精确回退时，允许进入 `direct_edit` 或匹配的 `workflow_action`。
- 修改范围、目标行为、副作用或跨 owner 协调仍未确定时进入 `task_plan`。

workflow gate、hook、push/check-all、task routing、update/self-update、发布快照或跨平台 skill 等影响面会提高证据、验证和回滚要求，但不能单独决定意图分类。例如“精确回退已知提交中的某一部分”可以是范围确定的直接操作，而“优化 push 门禁体验”需要先规划，因为目标行为和 owner 边界尚需决策。

## Current Draft Diff Handling

上一轮过早 direct edit 产生的 Flower self-update 特例草稿已撤掉；用户要求先回退 `feat(0.6): 允许 Push 显式跳过 Check-All`。当前实现侧回退范围是：

- `.agents/skills/trellis-push/SKILL.md`
- `.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `enhancements/0.6/.agents/skills/trellis-push/SKILL.md`
- `enhancements/0.6/.claude/skills/trellis-push/SKILL.md`
- `enhancements/MANIFEST.json`
- `test/js/update-spec-auto-decision.test.js`
- `test/js/workflow-gate-ownership.test.js`

同一历史提交里的 `update -y` 修复不回退。`.flower/` 当前未跟踪状态不属于本任务回退范围。

## Validation Strategy

- 单元/契约测试覆盖 `self-update` 输出和 `trellis-push` 行为文案。
- workflow gate ownership 测试覆盖 owner 唯一性与可达性。
- request intent routing 相关测试同时覆盖：设计反馈进入 `discuss`、原因核查进入 `inspect`、精确回退不被影响面关键词强制升级、开放式跨 owner 改造进入 `task_plan`。
- `npm run sync` 后验证 vendor 与 enhancements 关键文件一致。
- 按改动范围运行 `npm test`、`npm run patch:targets:check`、`node scripts/check-ai-context-budget.mjs`。
