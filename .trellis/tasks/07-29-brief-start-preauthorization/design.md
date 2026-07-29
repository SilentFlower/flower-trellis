# Brief 显式预授权最小设计

## 1. Boundary

本次只修改 AI 工作流策略，不新增运行时机制：

```text
用户表达
  -> Phase 1.4 / trellis-task-brief 判断是否为显式预授权
  -> 完整展示最终 Brief
  -> 默认等待确认，或在窄例外下同回合 task.py start
```

`task.py start` 继续只负责现有 Brief 缺失和 freshness 门禁；auto-loop 保持不变。

## 2. Decision Rules

| 场景 | 处理 |
| --- | --- |
| “开始做吧”“按你建议来”“可以创建任务” | 仅视为普通实现或规划意图，展示 Brief 后等待确认 |
| “最终 Brief 展示后直接开始，不用再问” | 视为显式预授权 |
| 最终 Brief 范围未变、无 Open Questions、无新增高风险边界 | 完整展示后同回合启动 |
| 范围扩大、存在 Open Questions、新增高风险边界或用户撤回 | 预授权失效，展示后等待确认 |
| 对话上下文无法明确证明预授权仍适用于当前任务 | 使用默认确认路径 |

## 3. Ownership

- Phase 1.4 Patch：声明默认路径和显式预授权窄例外。
- `trellis-task-brief`：负责识别边界、刷新和完整展示 Brief，并告诉主 workflow 是等待还是继续启动。
- 文案契约测试：防止后续重新引入 session helper 或机械门禁。

## 4. Compatibility

- 不改变现有 task 状态、session pointer、hook 和回滚行为。
- 不改变 schema 1/2 auto-loop。
- 不承诺压缩或新会话后的预授权恢复；证据不明确时回到默认确认路径。
