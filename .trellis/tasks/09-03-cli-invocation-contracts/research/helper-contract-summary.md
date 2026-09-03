# Helper 契约摘录

## 来源

- `.trellis/spec/flower-trellis/cli/enhancements-model.md`：项目知识发现、Auto Loop decision log、Minimal Trellis Push And Task Progress。
- `.trellis/spec/flower-trellis/cli/config-and-state.md`：worktree 本地 runtime 边界。

## 与本任务直接相关的既有约束

### Decision Log

- `decision_log.py` 保存 append-only decision/review 事件，损坏 JSONL 必须失败关闭。
- `decision_log.py` 同时服务 `trellis-auto-loop` 与 `trellis-finish-work`，选择性安装不能遗漏脚本或 archive guard。
- 本任务只统一 `--task` 解析和帮助，不改变 decision/review schema、digest、审核状态或归档门禁。

### Task Progress

- progress schema 固定为 `updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes`。
- `task_progress.py write` 必须拒绝额外字段，只接受 `status=in_progress`；`--complete` 原子写入 progress、`completed` 和 `completedAt`。
- 写入必须使用目标目录临时文件、flush、`fsync` 和 `os.replace`；校验或写入失败时旧 `task.json` 字节保持不变。
- `trellis-continue` 是 progress 恢复的读取 owner；本任务不能把 progress 扩展成 Git、push mode 或完整计划存储。
- 因此本任务只允许在字段完全缺失时生成机械字段 `updatedAt`，不得为其它业务字段补默认值或放宽额外字段校验。

### Untracked Flow 与 Runtime

- `untracked_flow.py` 是 session-scoped workflow cursor，不证明 Git scope、owner evidence 或检查结果。
- linked worktree 只能向上查找当前 cwd 本地 `.trellis`，缺失时必须返回 `not-trellis-project`，不能读取其它 worktree runtime。
- 活动 task 与 untracked work 的写入互斥仍是安全边界；本任务只把 `status` 查询的活动 task 情况改成中性 `not-applicable`，不能放宽 `begin/advance/clear`。

### Patch 与派生物

- Skill-Garden 的 helper/override 是 canonical 来源；Flower `enhancements/0.6` 和当前项目 `.trellis` 是同步或编译产物。
- `task.py` 属于 Trellis 上游脚本，Flower 行为变化应通过现有 Patch/Bundle 注入并运行 compiled target 检查。
- 修改 helper 后至少运行相关 Python 单测、`python3 -m py_compile`、`npm run sync`、`npm run patch:targets:check` 和快照检查。

### CLI Help

- Flower 命令错误由命令层抛出、`src/cli.js` 顶层统一输出；usage error 与执行错误的退出码边界必须保持。
- 网络探测、交互 prompt 和 PTY 都有非交互与失败降级契约。帮助请求应在这些动作之前返回，避免把文档查询变成运行流程。
