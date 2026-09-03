# 技术设计：统一 CLI 调用契约与帮助体验

## 1. 总体方案

本任务不引入新的 CLI 框架，而是在现有 Node 编排层和 Python helper 边界上统一四类契约：

1. 查询命令把“空状态/不适用”作为成功结果，用结构化字段表达。
2. 接受任务引用的 helper 复用公共解析器。
3. 进度写入由 helper 生成机械元数据，调用方只提供业务状态。
4. Flower 帮助在命令副作用前短路，并通过统一测试矩阵约束。

真实的解析错误、状态迁移错误、写入失败和安全护栏继续返回非零。

## 2. 状态查询契约

### 2.1 `task.py current`

`cmd_current` 成功读取 session runtime 后始终返回 0：

- 有任务：保持现有任务路径或 JSON 对象。
- 无任务：文本模式输出明确的 `No current task set`；`--source` 保持 `Current task: (none)`；`--json` 返回 `current_task: null`。
- runtime 损坏、读取失败或参数错误仍返回非零。

仓库内需要严格要求活动任务的调用方不得再把 `task.py current` 的退出码当门禁，应解析 JSON 或调用 `common.active_task.resolve_active_task` 后自行验证 `task_path`。

由于 `task.py` 是 Trellis 上游脚本，行为修改通过 Skill-Garden 的脚本 Patch 注入，并用编译目标测试验证，而不是只改当前 `.trellis/scripts/task.py`。

### 2.2 `untracked_flow.py status`

将 runtime scope 的“解析 session”和“禁止活动任务”分开：

- `status` 允许读取已有活动任务的 session；若存在活动任务，返回：

```json
{
  "status": "not-applicable",
  "reason": "active-task-present",
  "task": ".trellis/tasks/<task>"
}
```

- 无活动任务时继续返回现有 `hit` 或 `miss`。
- `begin`、`advance` 以及普通 `clear` 保持活动任务互斥门禁；仅现有 adoption 清理路径继续使用明确的 `allow_active_task`。

这样 workflow 的探测调用不会显示红色失败，同时不会放宽写入路径。

## 3. 任务引用契约

`decision_log.py` 删除独立的目录拼接解析，改为复用 `common.task_utils.resolve_task_dir`，随后执行自己的目录存在性和边界校验：

- 精确目录名优先。
- 唯一的 `-<短名>` 后缀可解析。
- 多个后缀匹配必须报告歧义，不能取遍历顺序中的第一个。
- 相对路径和绝对路径解析后必须位于 `.trellis/tasks` 的直接或允许层级内；归档任务是否允许由当前 decision log 生命周期契约决定，不借本任务扩张范围。

公共 `find_task_by_name` 当前遇到多个后缀匹配时取首个，实施时应把“唯一匹配/歧义”能力放在公共层，确保 `task_progress.py` 与 `decision_log.py` 获得相同行为。所有受影响调用方和测试一起迁移。

## 4. Progress 输入归一化

在 `_validate_progress` 前增加窄范围归一化：

- 输入不是对象时直接进入现有错误路径。
- `updatedAt` 字段完全缺失时，复制输入对象并填入当前 UTC ISO-8601 时间。
- 字段存在但为空、类型错误或格式明显无效时保持校验失败。
- 其余字段不补默认值，额外字段仍拒绝。

帮助文本使用 `argparse.RawDescriptionHelpFormatter` 和 epilog 展示完整字段清单及最小 JSON 示例。自动时间生成逻辑应支持注入或 patch 时间函数，避免测试依赖真实时钟。

## 5. Flower 帮助分发

### 5.1 副作用边界

帮助请求必须在以下动作之前完成：

- `checkForUpdate` 或其它网络探测。
- `syncGlobalTrellis`、配置写入、备份快照和 Plugin replay。
- `buildSelfCheck`、安装全局包和启动 Trellis 子进程。
- Inquirer prompt 或 PTY 创建。

### 5.2 实现形态

- 保留 `src/cli.js` 的顶层根帮助。
- 在各命令公开入口最前面识别 `-h/--help`；已有 `plugin`、`trellis`、`skill`、`worktree` 的逻辑直接纳入测试矩阵。
- 对多个简单一级命令可复用一个很小的 `isHelpRequest(args)` helper；帮助正文仍由命令所有者维护，避免把所有参数知识重新堆进 `cli.js`。
- `update`、`self-update` 必须优先补齐，因为当前帮助参数会进入联网或更新编排。
- 未知参数的错误应附带对应的 `flower-trellis <command> --help` 引导，但不得把未知参数静默忽略。

## 6. 真源与同步路径

Python helper 修改顺序：

1. `vendor/skill-garden/.trellis/0.6/` canonical 脚本或 Patch/Bundle。
2. 运行项目既有 `npm run sync` 生成 `enhancements/0.6` 快照。
3. 通过既有 dogfood/compiled-target 流程更新并验证当前 `.trellis` 副本。

禁止分别手工维护三份实现。同步过程中只接受由 canonical 变化产生的预期派生差异。

## 7. 测试策略

- Python helper 使用临时 Trellis 项目和临时 session runtime，分别断言退出码与 JSON payload。
- 公共任务解析器覆盖精确、唯一后缀、歧义、不存在、项目外路径。
- Progress 测试通过注入固定时间断言自动字段，不使用模糊正则替代值校验。
- Node 帮助测试使用子进程检查真实退出码/stdout/stderr；对 `update`、`self-update` 另用依赖注入或静态契约测试证明帮助分支位于所有副作用之前。
- 运行 Patch compiled targets、快照一致性和全量测试防止派生物漂移。

## 8. 兼容性与回滚

- 主要兼容性变化是 `task.py current` 空状态由 1 改为 0。仓库内调用方必须同批迁移，发布说明需明确外部脚本应读取输出而非退出码判断是否有任务。
- 其它非零路径均保持或收紧，不放宽真实错误。
- 若发布后发现外部依赖无法及时迁移，可增加显式严格探测选项作为后续兼容层；本任务不预先引入未被证据要求的参数。
- 回滚时按 canonical 变更回滚并重新生成快照，不能只回滚派生副本。
