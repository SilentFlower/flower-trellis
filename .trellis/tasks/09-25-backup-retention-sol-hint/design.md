# 升级备份精简与 Sol 专属提示设计

## 范围与数据流

- 备份保留：`src/constants.js` 的默认数量进入 `parseCliArgs()`，再由 `normalizeUpdateBackupRetention()` 和 `update()` 传给现有清理计划。只调整默认值与其说明、断言；显式 `--backup-retention`、成功路径和安全过滤保持现有实现。
- 模型提示：Codex SessionStart 的 `model`、`source` 与 `part` 进入 `src/assets/flower_session_start.py`。现有 `state` 渲染成功后按精确模型选择提示，读取项目 `codex` 配置，再附加对应模型的一个提示块。Flower 仍通过现有资产投影安装该源脚本。

## 提示正文与选择

`gpt-6-sol` 复用现有 Astra 英文工作流正文，保持相同的步骤、引用、模板、授权、证据和纠错边界。模型适用声明中的 `gpt-6-astra` 改为 `gpt-6-sol`，标签改为闭合的 `trellis-sol-workflow-hint`。以一个共享正文生成两份最终常量，避免两份长正文日后漂移；现有 `ASTRA_WORKFLOW_HINT` 保持独立可检查的最终值。

仅当 `hook=.codex/hooks/session-start.py`、`part=state`、`source=startup|clear|compact`，且事件 `model` 精确为两个受支持字符串之一时，追加所选模型的一块提示。不得从配置猜测当前模型、修剪模型名或匹配别名。Claude、rules/stages 和 UserPromptSubmit 不进入该分支。

Sol 使用独立的 `codex.sol_workflow_hint` 开关，缺省 `true`。继续使用 `common.trellis_config.read_trellis_config`，只接受布尔值以及不区分大小写的字符串 `true`/`false`；非法配置只诊断对应可选提示，保留原生 state。每个模型最终块独立接受 2048 UTF-8 字节限制，关闭开关只停止后续新增，不撤回历史上下文。

## 备份边界

默认数量由 3 改为 1。既有清理算法会优先保护本轮新增的合法备份；一次更新若产生多份受保护备份，允许临时超过默认数量，避免把本轮恢复点当作旧备份删除。显式数量、`0`、dry-run、enhance-only、失败时零清理及 `.backup-flower` 排除均不变。

## 验证与回退

- 更新备份默认值、CLI 解析、计划和安全清理的定向测试；使用隔离项目检查 dry-run 预览与无写入。
- 扩展 SessionStart 测试，检查两个模型各三种来源、三个分段、其他模型、Claude、两个独立开关、非法值、禁用、模型切换、失败诊断和预算上限；确认实际安装和重复更新投影一致。
- 扩展上下文预算 fixture，分别计量 Sol 与 Astra 完整块，并继续按同一时刻最大实际场景计算总量；不因新增场景直接上调阈值。
- 回退时恢复默认常量及相关文档/断言；Sol 可在项目配置中用 `sol_workflow_hint: false` 停止后续新增。既有 Astra 提示与项目已有备份仍保留。

## 风险与证据边界

`gpt-6-sol` 与 Astra 对同一正文的行为反应可能不同；自动化测试只证明正确注入。若没有独立的真实模型对照，不宣称遵循率提升。Hook 改动需按项目跨平台质量规范核对已有 CI 覆盖；匹配变更提交的 CI 未运行前，不声称 Windows 兼容验收通过。
