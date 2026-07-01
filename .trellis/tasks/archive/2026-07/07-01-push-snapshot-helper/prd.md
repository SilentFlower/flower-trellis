# 设计 push snapshot helper

## Goal

为 `trellis-push` 的任务进度快照提供一个轻量 Python helper，统一读取和写入 `task.json.last_push_snapshot` 的机械 JSON 操作，降低 AI 手工解析 / 改写 JSON 的风险，同时避免引入新的恢复状态机。

该任务包含设计与实现。实现范围保持轻量：新增 helper、调整 `trellis-push` 使用方式，并同步强化包快照。

## Background

- 当前 `trellis-push` 通过文档流程生成并写入 `last_push_snapshot`，字段包括 `snapshot_at`、`branch`、`pushed_commits`、`completed_steps`、`partial_step`、`next_step` 和 `notes`。
- `last_push_snapshot` 的语义内容仍由 `trellis-push` 执行计划生成，并在执行前由用户确认。
- 用户明确不希望把该能力接入 `session-start.py` 或 `inject-workflow-state.py`，也不希望改 `trellis-continue`。
- helper 应服务 `trellis-push` 链路内部，以及用户手动查询“push snapshot 到哪一步了”的场景。

## Requirements

- R1. 新增一个轻量脚本，暂定名为 `.trellis/scripts/push_snapshot.py`，用于读取和写入任务的 `last_push_snapshot`。
- R2. 脚本必须保持窄职责：只处理 `last_push_snapshot` 的定位、校验、读取和写入，不推断任务阶段，不生成 `completed_steps` / `next_step`，不执行 git 操作。
- R3. `trellis-push` 的写入步骤应调用该脚本完成 JSON 写入，而不是要求 AI 手工编辑 `task.json`。
- R4. `trellis-push` 的读取步骤可调用该脚本读取当前 active task 或指定 task 的已有 snapshot，用作生成新 snapshot 草案的输入。
- R5. 脚本不得接入或修改 `session-start.py`、`inject-workflow-state.py`、`trellis-continue`。
- R6. 脚本不写 `.trellis/.runtime/`，不记录“已提示过”，不维护恢复状态。
- R7. 写入命令必须只更新 `last_push_snapshot` 字段，保留 `task.json` 其他字段语义和格式习惯。
- R8. 写入命令必须校验 snapshot schema，拒绝明显不合法的字段类型或缺失关键字段。
- R9. 读取命令在无 active task 时可以列出 active tasks 中 `status=in_progress` 且存在 `last_push_snapshot` 的候选，但这只是查询结果，不自动 rebind task。
- R10. 输出应支持机器可读 JSON；默认输出应精简，便于 AI 和人类读取。
- R11. 作为强化脚本发布时，`--skills trellis-push` / `--skills push` 等精细安装应同时铺设 `push_snapshot.py`。
- R12. `workflow.md` / `workflow-states` 中关于 push snapshot recovery 的高频文案应瘦身为 helper 入口和边界提示，不再内嵌手工扫描 / 手工编辑 `task.json` 的细节。

## Proposed Interface

```bash
python3 ./.trellis/scripts/push_snapshot.py status [--task <task-dir>] [--json]
python3 ./.trellis/scripts/push_snapshot.py write --task <task-dir> --snapshot-json '<json>' [--json]
```

`status` 行为：

- 指定 `--task` 时读取该任务的 `last_push_snapshot`。
- 未指定 `--task` 且存在 active task 时读取 active task 的 `last_push_snapshot`。
- 未指定 `--task` 且无 active task 时，扫描 active task tree 中带 snapshot 的 `in_progress` 任务并返回候选。

`write` 行为：

- 解析并校验 `--snapshot-json`。
- 解析任务目录并读取 `<task>/task.json`。
- 只设置 / 更新 `last_push_snapshot`。
- 输出写入摘要。

## Non-Goals

- 不新增完整的 resume runner。
- 不替代 `trellis-push` 的计划、确认、git 安全门禁、commit / push / merge 行为。
- 不接入 SessionStart 或每轮 workflow-state 注入。
- 不修改 `trellis-continue`。
- 不自动判断任务应该进入 Phase 2.1 / 2.2 / 3.3 / 3.4。
- 不基于聊天摘要、compact summary 或 runtime 状态推断工作进度。

## Technical Notes

- 该脚本如果作为 0.6 强化能力发布，应放入 `vendor/skill-garden/.trellis/0.6/scripts/`，再通过 `npm run sync` 同步到 `enhancements/0.6/scripts/` 和当前 dogfood `.trellis/scripts/`。
- `copy-scripts.js` 需要能在全装时铺设脚本；若支持精细安装，应让 `--skills trellis-push` 或等价 skill 过滤也带上该脚本。
- `trellis-push` skill 文案应改为调用 `push_snapshot.py status/write`，但仍保留“先计划、一次确认、后执行”的门禁。
- `workflow.md` 的 `Push Progress Recovery / Snapshot` 段应指向 `push_snapshot.py status/write`，说明 helper 只触碰 `task.json.last_push_snapshot`，并保留不自动 rebind、不推断 phase、不接入 SessionStart / workflow-state injection / `trellis-continue` 的边界。
- `workflow-states` 只保留 breadcrumb：按 hub 规则处理，需要时调用 `push_snapshot.py status --json`。
- 错误处理应倾向返回清晰错误和非 0 退出码；读取类失败可降级为无 snapshot，写入类失败必须阻断写入。

## Acceptance Criteria

- [ ] PRD 明确 `push_snapshot.py` 的职责边界、接口和非目标。
- [ ] 设计不要求修改 `session-start.py`、`inject-workflow-state.py` 或 `trellis-continue`。
- [ ] 设计明确 `trellis-push` 仍负责 snapshot 语义生成、用户确认和 git 操作。
- [ ] 设计明确 `push_snapshot.py write` 只更新 `last_push_snapshot` 字段。
- [ ] 设计明确 `push_snapshot.py status` 可读 active task、指定 task、或无 active task 时的 snapshot 候选。
- [ ] 若进入实现，`trellis-push` Step 0 / Step 5 的文案改为使用该脚本。
- [ ] 若进入实现，`workflow.md` / `workflow-states` 的 push snapshot recovery 文案改为引用 helper，避免重复描述 JSON 扫描和写入细节。
- [ ] 若进入实现，新增脚本通过 `python3 -m py_compile`。
- [ ] 若进入实现，验证合法写入、非法 schema 拒绝、无 active task 候选查询、无 snapshot 查询降级。

## Decision

- 2026-07-01：本任务包含实现，不另开实现任务。
