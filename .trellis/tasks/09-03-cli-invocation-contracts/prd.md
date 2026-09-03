# 优化 CLI 调用契约与帮助体验

## Goal

统一 Flower/Trellis CLI 的查询状态、任务引用、结构化写入和帮助行为，减少 AI 或脚本因正常空状态、参数不一致、必填元数据和缺失帮助而产生的失败与无意义重试，同时保留真正的安全护栏和写入失败语义。

## Background

本地 Claude 与 Codex 历史会话扫描显示，调用失败并非平均分散，而是集中在以下契约边界：

- `untracked_flow.py` 观测到 69 次非零返回，其中 63 次是已有活动任务时查询 `status` 得到 `active-task-present`，分布于 38 个会话。
- `decision_log.py` 观测到 39 次非零返回，分布于 30 个会话，常见原因是传入短任务名后无法解析带日期前缀的目录。
- `task_progress.py` 观测到 18 次非零返回，分布于 13 个会话，多数是写入时遗漏 `updatedAt` 等 schema 字段。
- `task.py current` 约 114 次在“当前没有任务”这一正常状态下返回 1，终端和工具界面会将其显示为执行失败。
- Flower `worktree` 历史上有 5 次帮助调用失败；当前工作区已有对应的 `worktree --help` 修复，但尚未形成覆盖全部一级命令的统一帮助契约。
- Maven 验证的非零返回主要是工作区变化、计划根目录和证据缺失等安全护栏，不属于本任务要消除的失败。

上述数字包含同一会话的重复尝试，只用于判断问题集中区域，不作为独立缺陷数量。

## Confirmed Facts

- 当前 `task.py current` 在无活动任务时，即使使用 `--json` 也返回 1；JSON 已能表达 `current_task: null`。
- 当前 `untracked_flow.py status` 会先经过禁止活动任务的 runtime scope 校验，因此无法返回一个中性的“不适用”状态。
- `task_progress.py` 已复用 `common.task_utils.resolve_task_dir`，支持任务目录、路径和无日期前缀短名；`decision_log.py` 使用独立解析逻辑，不支持同等的短名后缀匹配。
- `task_progress.py write` 要求调用者提供完整 progress 对象，其中 `updatedAt` 是必填字段。
- Flower 顶层只在帮助参数位于 argv 首位时打印根帮助；`update` 和 `self-update` 没有在副作用前处理自己的 `-h/--help`。
- 当前工作区中的 `src/commands/worktree.js`、`src/cli.js` 和 `test/js/worktree-cli.test.js` 已有未提交的 worktree 帮助改动，后续实现必须保留并纳入统一测试。

## Requirements

### R1. 查询状态不再伪装成执行错误

- `task.py current` 在命令成功读取状态但当前无活动任务时返回退出码 0；文本或 JSON 输出必须明确表达“无当前任务”。
- `untracked_flow.py status` 在 session 已绑定活动任务时返回退出码 0，并输出稳定的中性状态，例如 `status=not-applicable`、`reason=active-task-present` 和当前任务引用。
- `untracked_flow.py begin`、`advance`、`clear` 等写入或状态迁移动作仍须在前置条件不满足时返回非零。
- 仓库内调用方不得继续依赖查询命令的非零退出码判断空状态，应读取结构化状态或公共 Python API。

### R2. 统一任务引用解析

- `decision_log.py` 与 `task_progress.py` 对 `--task` 使用同一公共解析规则：精确目录名、项目内相对路径、允许的绝对路径和唯一短名后缀均可解析。
- 短名存在歧义、目标不存在、目标位于活动任务目录之外时必须 fail closed，并返回稳定、可操作的错误信息。
- 帮助文本必须明确列出支持的任务引用形式，并给出短名示例。

### R3. 降低进度写入的手工 schema 成本

- `task_progress.py write` 在输入对象缺少 `updatedAt` 时自动生成 UTC 时间并持久化；调用者显式提供合法值时保持该值。
- 空字符串或类型错误的 `updatedAt` 仍视为无效输入，不能静默修复明显错误。
- `completedSteps`、`partialStep`、`nextStep`、`notes` 的窄 schema 与额外字段拒绝策略保持不变。
- `write --help` 必须展示字段清单和最小可运行示例，错误输出继续列出所有不合法字段。

### R4. Flower 一级命令提供无副作用帮助

- 对 Flower 自有一级命令执行一次帮助能力清点；每个一级命令及存在独立参数契约的子命令均支持 `-h/--help`。
- 帮助请求必须在版本联网检查、全局同步、写盘、交互 prompt 和子进程启动之前返回 0。
- 至少覆盖 `init`、`update`、`self-check`、`self-update`、`update-check`、`telemetry`、`trellis`、`skill`、`plugin`、`worktree`；已有帮助实现应复用，不重复建立第二套解析规则。
- 帮助内容至少包含用途、用法、关键选项和容易失败场景的下一步引导；`worktree create` 已有“新分支与已有分支”引导必须保留。

### R5. 真源、快照与项目副本保持一致

- Skill-Garden Python helper 先修改 canonical 真源，再通过项目既有同步流程更新 `enhancements/0.6` 快照和当前项目 dogfood 副本。
- `task.py current` 属于上游 Trellis 脚本，应通过现有 Patch/Bundle 机制实现并验证编译目标，不直接把 `.trellis/scripts/task.py` 当成唯一真源修改。
- 行为变化必须同步到相关 CLI/增强包规范，避免后续升级恢复旧契约。

### R6. 回归验证覆盖正常状态与真实错误

- Python 测试覆盖：无活动任务、已有活动任务、短名唯一/歧义/越界、自动生成 `updatedAt`、非法显式时间和额外字段拒绝。
- Node CLI 测试覆盖：一级命令根帮助、子命令帮助、退出码 0、stderr 为空，以及帮助路径零网络、零写入、零子进程。
- 快照一致性、Patch 编译目标、Python 语法和项目完整测试均通过。

## Acceptance Criteria

- [x] `task.py current` 的有效空状态不再产生非零退出码，JSON 明确返回空任务状态。
- [x] `untracked_flow.py status` 在活动任务存在时返回中性结构化结果，写入型命令的前置条件错误仍保持非零。
- [x] `decision_log.py status --task <短名> --json` 与 `task_progress.py status --task <短名> --json` 对同一唯一任务得到一致解析结果。
- [x] 歧义任务名、项目外路径和不存在任务仍被稳定拒绝。
- [x] `task_progress.py write` 可在未提供 `updatedAt` 时成功写入并生成合法 UTC 时间，窄 schema 的其他约束不放宽。
- [x] Flower 自有一级命令的 `-h/--help` 均在任何副作用前返回 0；测试证明不会触发网络、写盘、prompt 或子进程。
- [x] 当前已有的 `worktree --help` 内容和回归测试被保留并纳入统一帮助测试矩阵。
- [x] canonical Skill-Garden、`enhancements/0.6` 和当前项目 dogfood 副本不存在内容漂移。
- [x] 聚焦测试、Patch/快照检查与 `npm test` 全部通过。

## Out Of Scope

- 不改变 Maven verification 的计划根目录、workspace changed、evidence missing 等安全护栏。
- 不允许 `task_progress.py` 接受任意额外字段，也不把 progress 扩展成通用状态存储。
- 不重写整个 CLI 框架或引入新的命令解析依赖。
- 不改变任务创建、启动、归档和决策审核的权限边界。
- 不处理 OpenCode 历史会话采集能力。

## Risks And Constraints

- 外部脚本可能依赖 `task.py current` 的旧非零空状态；实现时需搜索并迁移仓库内调用方，发布说明中标明兼容性变化。
- Python helper 同时存在 canonical、增强快照和 dogfood 副本，必须按真源到派生物的顺序同步，禁止三处手工分叉修改。
- 当前工作区已有用户改动和 worktree 帮助改动，实施阶段不得回退或覆盖无关变更。
