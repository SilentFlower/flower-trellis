# Design — 修复 Trellis brief 确认门禁绕过

## Problem Model

当前 brief review 主要依赖提示词：Hub、`workflow-state:planning` 和 `trellis-task-brief` 都描述了正确流程，但它们不是同一个可达链路。

```text
no_task 用户回合
  -> 创建 planning task
  -> 同一 AI 回合继续写三件套
  -> planning breadcrumb 尚未重新注入
  -> Phase 1.4 按需正文没有 brief handoff
  -> task.py start 无确定性校验
  -> 直接进入 in_progress
```

修复需要同时覆盖“规则可见性”“明确交接动作”和“最后防线”，不能只在现有 planning state 再补一句同义文案。

## Architecture

采用三层互补门禁：

1. **高频控制上下文**：调整 Workflow Hub 中 `Task Brief Handoff` 的位置和短规则，使其位于较长的 Project Knowledge Discovery 之前。SessionStart/Phase summary 即使发生中段截断，也应优先保留 brief review 不变量。
2. **规划交接层**：Phase 1.4 正文和 `trellis-brainstorm` 最终正文都显式进入 `trellis-task-brief`，展示完整 brief 后停止当前回合；早于最终 planning artifacts 的实现意向不算 planning review。
3. **确定性脚本层**：`task.py start` 在执行 `planning → in_progress` 前验证 brief 存在且新鲜。校验失败返回非零，不写状态、不触发 `after_start` hook，也不新增确认 token。

## Workflow And Skill Changes

### Workflow Hub

- 将 `Task Brief Handoff` 移到 `Brainstorm Gate` 之后、Project Knowledge Discovery 之前。
- 保持 Hub 只描述跨阶段不变量，不复制 `trellis-task-brief` 的完整模板和执行细节。
- 明确“用户在最终三件套和 brief 形成前表达的实现意向，不替代 planning review”。

### Phase 1.4

通过新的 Workflow Patch 替换 `#### 1.4 Activate task` section，使按需上下文自包含：

1. 调用 `trellis-task-brief` 刷新派生摘要。
2. 在对话中展示完整 `brief.md`。
3. 明确停止并等待用户确认。
4. 只有后续用户确认后才运行 `task.py start`。
5. 保留轻量/复杂任务产物要求、JSONL ready gate 和 session identity 错误处理。

### Trellis Brainstorm

新增受管的 `Planning Handoff` section：

- Quality Bar 达标后进入 `trellis-task-brief`。
- 生成并展示 brief 后结束当前回合。
- 用户确认前禁止运行 `task.py start` 或开始实现。
- 早于最终 planning artifacts 的“按方案改”“继续做”等消息只能授权规划，不能视为最终 review。

## Task Start Guard

### Trigger

仅当 `<task>/task.json` 存在且 `status == "planning"` 时执行 brief guard。

已经 `in_progress` 的任务调用 `task.py start` 仅用于重新绑定 session active-task pointer，保持兼容，不因历史缺少 brief 被阻断。

### Authoritative Inputs

- 必读：`prd.md`（存在时参与新鲜度比较）。
- 可选：`design.md`、`implement.md`（存在时参与新鲜度比较）。
- 派生产物：`brief.md`。

### Validation

在 `set_active_task`、状态修改和 `run_task_hooks("after_start", ...)` 之前执行：

1. `brief.md` 不存在：打印错误和 `trellis-task-brief` 恢复指引，返回 `1`。
2. 读取文件时间失败：默认失败关闭，返回 `1`。
3. 任一存在的权威 planning artifact 的 `st_mtime_ns` 大于 `brief.md`：列出过期来源，提示刷新 brief，返回 `1`。
4. brief 存在且不早于所有权威输入：继续现有 start 行为。

使用严格大于比较；相同时间视为未过期，避免文件系统时间粒度导致无意义阻断。

### Side Effects

- Guard 失败时不修改 `task.json.status`。
- Guard 失败时不调用 `set_active_task`，但 `task.py create` 已建立的 planning pointer保持不变。
- Guard 失败时不运行 `after_start` hook。
- 不写 `task.json.meta`，不增加 review 状态或确认参数。

## Patch And Distribution

真实源位于 `vendor/skill-garden/.trellis/0.6`：

- 更新 Workflow Hub `content.md`。
- 新增 Phase 1.4 Workflow Patch。
- 新增 `trellis-brainstorm` planning handoff Skill Patch。
- 新增 `.trellis/scripts/task.py` start guard File Patch。
- 在 `intent-routing` Bundle 中登记新 Patch。
- 在 `conflicts.json` 增加最终产物 required-literal 断言，确保 Phase 1.4、brainstorm handoff 和 task start guard 均实际存在。

随后运行 `npm run sync` 生成 `enhancements/0.6` 快照，并通过 Flower enhance-only update 将相同结果应用到当前 dogfood `.trellis/workflow.md`、skills 和 `task.py`。

不直接修改 `node_modules/@mindfoldhq/trellis`，也不把 Flower 自有脚本复制逻辑扩展为覆盖原生 `task.py`；原生文件修改继续由 Patch Engine 管理。

## Tests

### Patch Tests

- JS/Python Patch fixture 必须提供上游 0.6.5 的 Phase 1.4、brainstorm Quality Bar 和 `cmd_start` baseline。
- 验证新 operation 被 `intent-routing` Bundle 选择。
- 验证最终 workflow/skill/script 包含唯一 managed marker 和所需语义。
- 验证重复应用文件树不变。
- 验证 selector/baseline 漂移时全量预检零写入。

### Runtime Tests

新增隔离 Python 测试，复制最终 dogfood `task.py` 及其 `common/` 依赖：

- planning task 缺少 brief：退出 `1`、状态仍为 planning、hook 未运行。
- planning task brief 早于 PRD：退出 `1`。
- planning task brief 早于 design 或 implement：退出 `1`。
- planning task brief 新鲜：退出 `0`、状态变为 in_progress。
- in_progress 历史任务缺少 brief：允许重新绑定。
- 无 session identity 的 degraded start 同样先经过 guard。

### Context Tests

- `get_context.py --mode phase --step 1.4` 包含 brief handoff 和 stop/wait 语义。
- Phase summary/SessionStart 最终输出在预算内保留早置的 Task Brief Handoff。
- 运行默认和 strict AI context budget；不得通过提高阈值消除 warning。

## Compatibility

- 仅强化 Trellis `0.6` 变体；`0.5` 和 legacy 不在本任务范围。
- 旧的 planning task 需要先生成 brief 才能首次进入 in_progress，这是预期收紧。
- 已经 in_progress 的旧任务不要求批量补 brief，重新绑定行为不变。
- PRD-only 轻量任务只比较 `prd.md`；复杂任务比较实际存在的三件套文件。
- auto-loop 已有 `refresh_brief → start_task` 状态，正常路径与新 guard 一致。

## Trade-offs

- 文件时间不是用户确认凭据，但能确定检测“缺失/规划变更后未刷新 brief”，正好承担脚本层可验证职责。
- 不新增 review token，避免制造无法证明真人确认的伪安全状态和额外迁移成本。
- Phase 1.4、brainstorm 和 Hub 各保留一跳边界会增加少量上下文，但职责不同；完整流程仍只存在于 `trellis-task-brief`。

## Rollback

- 从 `intent-routing` Bundle 移除三项新 Patch，并回退 Hub 顺序/短规则。
- 运行 `npm run sync` 和 dogfood enhance-only update 恢复最终副本。
- `brief.md` 普通任务文件无需迁移或删除。
