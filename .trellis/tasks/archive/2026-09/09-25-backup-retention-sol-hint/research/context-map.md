# 实施与检查的规范定位

本文件只标明必读原规范的位置，不替代原文。实施和检查前按标题读取完整相关章节；搜索命中不算完整读取。

- `.trellis/spec/flower-trellis/cli/config-and-state.md` 的 `Scenario: Update Backup Retention`：默认值、`0`、CLI 转发、更新成功边界、受保护的新备份、候选目录校验、dry-run 和所需测试。本任务会把其中默认值 3 更新为 1，其余安全契约继续适用。
- `.trellis/spec/flower-trellis/cli/trellis-patch-engine.md` 的 `Scenario: SessionStart Parts And Context Limit Preservation`：Flower 资产所有权、三分段、Astra 精确模型匹配、独立开关、可选提示失败降级、字节限制及安装验证。本任务新增 Sol 时保持这些边界，并同步该规范。
- `.trellis/spec/flower-trellis/cli/ai-context-budget.md` 的 `Final-Output Principle`、`Output Contract`、`Budget Table` 与 `Tests Required`：必须测真实分段输出、按单次最大场景计量，不用新阈值掩盖增长。
- `.trellis/spec/flower-trellis/cli/quality-guidelines.md` 的 `Testing` 和 Python 跨平台场景：本地测试、安装 dogfood、Ubuntu/Windows CI 的证据边界。
