# 修复 route 裸数字选择压缩误用 - 设计

## 目标边界

本任务通过强化 prompt 契约修复 route fallback 的误用风险。核心约束是保留裸数字快捷回复，但把它限定为“紧邻当前 route 选项消息”的一次性解释，禁止 agent 从摘要、历史消息或压缩恢复上下文里复用裸数字。

## 文件边界

- 源：`vendor/skill-garden/.trellis/0.6/`
  - `.agents/skills/trellis-route/SKILL.md`
  - `.claude/skills/trellis-route/SKILL.md`
  - `overrides/workflow.md`
- 快照：`enhancements/0.6/`，通过 `npm run sync` 从源生成。
- 当前 dogfood 副本：
  - `.agents/skills/trellis-route/SKILL.md`
  - `.claude/skills/trellis-route/SKILL.md`
  - `.trellis/workflow.md`
- 规范：`.trellis/spec/flower-trellis/cli/enhancements-model.md`

## 契约变更

1. `trellis-route` 的 Step 2 增加裸数字有效性规则：
   - 有效：用户在当前 route 选项消息之后紧邻回复裸数字，且目标 target 与刚展示的选项一致。
   - 无效：compact summary、ordinary summary、SessionStart、replacement history、旧 target 的裸数字、非紧邻历史消息。
2. 输出模板增加一行提醒，要求下一轮主 agent 只有在紧邻回复时才解释裸数字。
3. workflow hub 只保留轻量 route evidence 提醒，显式把历史裸数字列入“不能作为证据”，并指向 `trellis-route` 负责 numbered fallback 细节；workflow-state 不重复该细节。
4. 不变更 `route_state.py`。helper 继续负责 runtime/prefs/auto-loop 校验；裸数字有效性属于 fallback 交互前置规则。

## 同步策略

先改 `vendor/skill-garden/.trellis/0.6` 源文件，然后运行 `npm run sync` 生成 `enhancements/0.6`。最后把当前 dogfood 副本更新到同样语义，确保当前会话立即受益。

## 风险与回滚

- 风险：文案过长会增加 route skill 阅读负担。控制为短规则，避免引入机械流程。
- 风险：只改源不改当前副本会导致本仓库继续使用旧规则。实施时必须显式同步当前副本。
- 回滚：撤销相关 markdown 改动并重新 `npm run sync`。
