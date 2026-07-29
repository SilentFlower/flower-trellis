# Brief — 支持 Brief 显式预授权免除重复确认

## Goal

- 当用户明确授权“最终 Brief 展示后直接开始、不用再次确认”时，完整展示并复核范围后直接启动，避免重复询问。

## Scope

- 更新 Phase 1.4 和 `trellis-task-brief` 的交互规则。
- 区分普通实现意图与明确绑定当前任务/最终 Brief 的预授权。
- 保留默认展示后确认流程，并规定范围扩大、Open Questions 和新增高风险边界时预授权失效。
- 同步 agents/claude、conflict assertion、发布快照和当前 dogfood。

## Non-Goals

- 不新增 session helper、handoff hash 或 `task.py start` 机械授权门禁。
- 不修改 auto-loop。
- 不提供跨会话或永久免确认偏好。
- 不改变 Check-All、Push、release、deploy 等独立门禁。

## Key Context

- 历史原话“我允许你的brief，等会你直接开工就行”“你当我默许就行”属于有效显式预授权。
- “开始做吧”“按你建议来”“可以创建任务”仍不是 Brief 预授权。
- 无法从当前对话明确证明预授权时，使用默认确认路径。

## Acceptance

- 明确预授权且最终范围不变时，完整展示 Brief 后同回合启动。
- 默认流程和高风险失效边界保持清晰。
- `task.py start`、auto-loop 和 session runtime 不发生相关改动。
- 文案契约、同步和完整测试通过。

## Next Step

- Check-All 已通过；下一步进入 `trellis-update-spec`，再由 `trellis-push` 生成精确提交计划。
