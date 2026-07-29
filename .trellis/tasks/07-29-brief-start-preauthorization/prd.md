# 支持 Brief 显式预授权免除重复确认

## Goal

当用户在当前规划对话中明确表示“最终 Brief 展示后直接开始，不需要再次确认”时，允许 AI 在完整展示且复核范围未变化后直接启动任务，避免重复询问。

## Background

- 默认 Phase 1.4 要求展示最终 Brief 后等待用户再次确认。
- 历史会话中，用户已明确说“我允许你的brief，等会你直接开工就行”“你当我默许就行”，旧规则仍要求再次回复确认。
- 这属于交互规则优化，不需要新增 runtime 状态、hash 门禁或 auto-loop 协议。

## Requirements

### R1. 保留默认确认路径

- 普通情况下，完整展示最终 Brief 后结束当前回合并等待确认。
- “开始做吧”“按你建议来”“可以创建任务”等普通实现或建任务意图不构成 Brief 预授权。

### R2. 支持显式预授权窄例外

- 只有用户明确指向当前任务或最终 Brief，并表达“展示后直接开始”“不用再次确认”“视为已确认”等含义时，才可免除第二次确认。
- 预授权必须仍明确存在于当前对话上下文中，不建立跨会话、跨任务或永久偏好。
- 即使存在预授权，也必须刷新并完整展示最终 Brief。

### R3. 预授权失效边界

- 最终 Brief 扩大目标、范围、风险或验收标准时失效。
- 存在未解决 Open Questions 时失效。
- 新增权限、安全、隐私、生产、费用、真实数据、破坏性公开契约或外部系统边界时失效。
- 用户撤回或表达冲突意图时失效。

### R4. 作者源与同步

- 修改 Skill-Garden 的 Phase 1.4 Patch 和 `trellis-task-brief` agents/claude 作者源。
- 更新对应 conflict assertion 和文案契约测试。
- 经 `npm run sync` 同步 `enhancements/0.6`，再更新当前 dogfood。

## Acceptance Criteria

- [ ] 历史明确预授权表达在最终范围不变时，完整展示 Brief 后直接启动，不再要求第二次确认。
- [ ] 普通实现意图仍走默认展示后确认流程。
- [ ] Brief 展示、Planning Quality Bar 和 Open Questions 边界不会被跳过。
- [ ] 范围扩大或新增高风险边界时重新等待确认。
- [ ] 不新增 helper，不修改 `task.py start`，不改变 auto-loop runtime。
- [ ] agents/claude 语义一致，vendor、snapshot 和 dogfood 同步通过。

## Out Of Scope

- 跨会话恢复预授权。
- session runtime、handoff hash 或机械授权门禁。
- auto-loop、Check-All、Push、release、deploy 等独立授权流程。
- 自然语言关键词解析器或永久“永不确认”设置。
