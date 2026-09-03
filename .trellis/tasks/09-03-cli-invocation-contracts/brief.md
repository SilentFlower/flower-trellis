# Brief — 优化 CLI 调用契约与帮助体验

## Goal

- 统一 Flower/Trellis CLI 的查询状态、任务引用、结构化写入和帮助行为，减少正常状态误报、参数猜测和无意义重试，同时保留真实错误与安全护栏。

## Scope

- 让 `task.py current` 的有效空状态返回成功，并让 `untracked_flow.py status` 在已有活动任务时返回中性的 `not-applicable` 结构化结果。
- 让 `decision_log.py` 与 `task_progress.py` 复用统一、确定性的任务引用解析，支持精确名、路径和唯一短名，歧义或越界继续失败关闭。
- 让 `task_progress.py write` 在缺少 `updatedAt` 时自动生成 UTC 时间，并补充字段清单和最小帮助示例；其它窄 schema 约束保持不变。
- 清点并补齐 Flower 自有一级命令及必要子命令的 `-h/--help`，确保帮助在网络、写盘、prompt 和子进程之前返回 0。
- 从 Skill-Garden canonical 真源同步 enhancement 快照和当前 dogfood 副本，补齐 Python、Node、Patch 和快照回归测试。

## Non-Goals

- 不改变 Maven verification 的 workspace、plan、evidence 等安全护栏。
- 不允许 progress 接受任意额外字段，不扩展为通用状态存储。
- 不重写 CLI 框架或引入新的命令解析依赖。
- 不改变任务创建、启动、归档和 decision review 权限边界。
- 不处理 OpenCode 历史会话采集能力。

## Key Decisions

- 查询命令的“空状态/不适用”是成功结果，通过 JSON 状态字段表达；写入、迁移和安全前置条件失败仍返回非零。
- 任务短名只在唯一后缀匹配时成功；多个候选必须明确报告歧义，不能依赖目录遍历顺序。
- `updatedAt` 仅在字段完全缺失时自动生成；显式空值、类型错误及其它缺失字段仍按现有 schema 拒绝。
- Flower 帮助由各命令所有者维护，在公开入口最前面短路；只在确有重复时抽取最小 helper，不建立第二套参数系统。
- 四类问题作为一个任务实施，因为它们共享退出码、可发现性、真源同步和测试矩阵；当前已有的 worktree 帮助改动作为基线保留。

## Key Context

- 历史高频集中项包括：`untracked_flow.py` 的 63 次 `active-task-present`、`decision_log.py` 的 39 次任务解析失败、`task_progress.py` 的 schema 失败，以及约 114 次 `task.py current` 正常空状态非零返回。
- Python helper 的 canonical 来源位于 `vendor/skill-garden/.trellis/0.6`；`enhancements/0.6` 和当前 `.trellis` 是同步或编译产物。
- `task.py` 是 Trellis 上游脚本，空状态契约应通过现有 Skill-Garden Patch/Bundle 修改并验证 compiled targets。
- 当前工作区已有未提交的 `src/commands/worktree.js`、`src/cli.js`、`test/js/worktree-cli.test.js` 帮助改动及其它用户文件，实施时不得回退或覆盖。

## Risks / Deferred

- 外部脚本可能依赖 `task.py current` 空状态退出码 1；仓库内调用方需同批迁移，兼容性变化需进入发布说明。
- canonical、enhancement 和 dogfood 三层容易产生漂移，必须使用既有同步流程并检查生成差异。
- OpenCode 历史未纳入统计，但不影响已由 Claude/Codex 和当前源码共同确认的四类契约问题。

## Acceptance

- `task.py current` 和 `untracked_flow.py status` 的正常空状态/不适用状态返回 0，真实 runtime 或写入错误仍非零。
- `decision_log.py` 与 `task_progress.py` 对相同唯一短名解析一致，歧义、不存在和项目外目标稳定拒绝。
- `task_progress.py write` 可自动补齐缺失的 `updatedAt`，但不放宽其它必填字段和额外字段校验。
- Flower 自有一级命令的帮助请求均零副作用返回 0，`worktree create` 的已有分支引导保持。
- canonical、enhancement 与 dogfood 副本一致，聚焦测试、Patch/快照检查和 `npm test` 全部通过。

## Next Step

- Full Check-All 重检已通过；当前进入 `trellis-update-spec`，再由 `trellis-push` 生成精确提交计划。
