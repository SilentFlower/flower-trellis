# Design

## Architecture

本任务修复三条运行时链路的边界：

```text
trellis-auto-loop skill
  -> .trellis/scripts/auto_loop.py
       -> Phase 2 route action must use trellis-route
       -> Phase 3.4 commit_only must use trellis-push boundary
       -> runtime pointer lifecycle must not leave stale current

trellis-route skill
  -> route_state.py
       -> runtime route decision
       -> personal prefs
       -> optional running auto-loop context

trellis-push skill
  -> AI-authored commit-only plan and execution
       -> exact file scope
       -> no push/merge/archive
       -> commit hash back to runner
```

关键原则：auto-loop runner 是调度器，不是 route 决策器，也不是 push 实现器。`trellis-auto-loop` skill 负责启动前的 route 准备度判断；runner 只发出 action，并记录由 `trellis-route` / `trellis-push` 产生的真实结果。

## Route Flow

### 当前问题

`trellis-auto-loop` skill 的默认启动命令写入：

```bash
--route-implement subagent
--route-check check-all-subagent
```

`auto_loop.py` 把这些值保存成 `route_authorization`，`route_state.py` 可在 prefs miss 时把它们当作 `origin=auto-loop` 命中。这会让 auto-loop 绕过本应由 `trellis-route` 完成的用户选择，且 runtime 看起来像已有真实 route。

### 目标设计

- 默认 `start` 不写任何 route 授权。
- `trellis-auto-loop` skill 在启动 runner 前先判断 route 准备度：已有 runtime 决策或个人 prefs 时可启动；没有时先调用 `trellis-route` 获取真实决策，再启动或继续。
- `run_implement` / `run_check_all` action 只提示进入对应 route gate。
- 主 agent 必须使用 `trellis-route`：
  - runtime hit：复用真实 route。
  - prefs hit：写回 runtime，作为真实 route。
  - miss：询问用户 / fallback，写回 runtime。
- auto-loop `record --action run_implement|run_check_all` 可选接收 resolved route 信息，写入 item-level summary，便于 resume/status 展示“真实跑的是 inline 还是 subagent”。

### Start Gate

planning start gate 需要判断 JSONL 是否必需。修复后不应再通过默认 auto subagent 授权强行要求 JSONL。准备度判断应前移到 `trellis-auto-loop` skill 启动阶段：

- 若个人 prefs 存在，skill 按 prefs 判断 JSONL 是否必需。
- 若当前 session 已有该任务真实 route_decision，skill 按真实决策判断 JSONL 是否必需。
- 若两者都没有，skill 先调用 `trellis-route` 获取真实决策；runner 不自行假设 route。
- `auto_loop.py` 的 start gate 只消费已解析出的 route context，不再通过默认 route 授权制造 subagent 前提。

实现时优先复用 `route_state.py resolve` 的确定性逻辑，避免在 `auto_loop.py` 里复制 prefs/runtime 解析。

## Commit-Only Flow

### 当前问题

skill 文档要求 commit-only 使用 `trellis-push`，但缺少确定性入口时，主 agent 容易手动执行：

```bash
git add ...
git commit -m ...
```

即使文件范围正确，也绕过了 `trellis-push` 的统一计划、未识别 dirty 隔离、snapshot 判断和 runner 回写语义。

### 目标设计

不新增 `push_commit_only.py`。文件归属判断属于 AI 的语义判断，不适合用 Python 基于 dirty baseline 或时间差猜测；脚本只负责 runner 状态，不负责提交归因。

`trellis-push` auto-loop commit-only 最小职责：

1. 读取 `auto_loop.py status`，确认 `run_status=running`、`profile=commit-only`、`outstanding_action.action=commit_only`。
2. AI 读取当前任务 artifacts、`git status`、`git diff` 和必要文件内容，生成 commit-only 计划；auto-loop 预授权时不等待二次聊天确认，但输出计划摘要。
3. 执行 `trellis-push` 预检：计划只包含当前任务可归属文件、不会 push/merge/archive/release、不会混入无法安全隔离的非本任务改动。
4. 按计划精确暂存 planned files 并 commit。
5. 输出 commit hash，并调用 `auto_loop.py record --action commit_only --result ok --commit <hash>`。

失败输出应由主 agent record failed/blocked，必须保证失败时不会误推进。

commit-only 预检失败只影响当前任务。多任务队列中，runner 应把当前 item 标记为 failed/blocked/skipped，写入失败原因和文件证据，然后继续尝试后续 item。只有全局性问题才停止整个 run，例如仓库存在 merge/rebase 冲突、无法确定当前仓库状态、脚本自身损坏，或用户明确要求停止。

## Completion Summary

内部 JSON 可以保留 item `status=completed` 以降低迁移风险，但输出层要降低误导：

- `_summary()` 增加 `auto_completed` 或 `committed` 列表。
- `resume_capsule` 增加 `task_lifecycle_note` 或 `unarchived_tasks`。
- `next` 返回 done 时带非阻塞提醒：`finish_work_required_for_archive=true`。
- 多任务队列只在所有 pending/running item 结束后输出提醒；中间不阻塞。
- 多任务队列中某个 item 因 Git 提交预检失败被 blocked/skipped 后，`next` 应继续寻找后续 pending item；最终 summary 汇总 blocked/skipped 与 completed。

## Decision Logging

### 当前问题

`auto-<id>.json` 目前主要记录 action、current_step、attempts、失败摘要和最终 commit。它能证明 runner 推进到了哪里，但不能回答这些关键复盘问题：

- implement/check route 最终真实选了什么模式？
- commit-only 的提交计划包含哪些文件，为什么不会混入其他非本任务改动？
- `trellis-push` 是否写了 `last_push_snapshot`，work commit 和 snapshot commit 分别是什么？
- auto-loop done 后哪些任务只是已本地提交，仍未 finish-work/archive？
- 哪些任务因为 Git 状态不安全被 blocked/skipped，后续队列是否继续？
- blocked/failure 的下一步建议是什么？

### 目标结构

在 run 或 queue item 上增加精简 `decision_log`，推荐按事件追加：

```json
{
  "at": "2026-06-29T08:03:10Z",
  "type": "route_resolved",
  "task": ".trellis/tasks/...",
  "summary": "implement route resolved to inline from route-prefs",
  "data": {
    "target": "implement",
    "mode": "inline",
    "source": "route-prefs"
  }
}
```

建议事件类型：

- `route_resolved`
- `commit_plan`
- `commit_completed`
- `snapshot_completed`
- `task_auto_completed`
- `task_skipped`
- `blocked`
- `warning`

### 记录原则

- 只记录结论、来源、关键字段和短摘要；不记录完整模型思维链。
- 由确定性 helper 或明确执行计划产生的字段优先，例如 `route_state.py` 输出、commit-only planned files、`git status` 文件列表。
- 决策日志服务恢复和审计，不能替代真正的 task artifacts、git commit 或 `trellis-push` 输出。
- 多任务队列中每个 item 记录自己的决策，同时 run-level summary 汇总未归档任务。

## Runtime Pointer Lifecycle

### auto_loop.py

- run 状态变为 `completed` 或 `stopped` 后，清理 `.trellis/.runtime/auto-loop/current.json`，但只在 pointer 仍指向当前 run 时删除，避免误删新 run pointer。
- `_load_current_state` 如果 pointer 指向非 running run，`status/resume/next` 的行为需要兼容：
  - 显式 `--run-id` 仍可读取 completed run。
  - 无 `--run-id` 时优先找唯一 running run；没有 running run 时可返回最近 completed run 用于 status，或提示没有 running run。实现时要保持现有 `status` 对当前 completed run 的可读性，避免破坏用户查看最近结果。

### route_state.py

- session `current_auto_run` 或 global pointer 指向非 running run 时，不直接返回 `auto-run-not-running` 作为最终结果。
- 忽略 stale run 后扫描 `.trellis/.runtime/auto-loop/auto-*.json` 中唯一 running run。
- 多个 running run 或没有 running run 时返回 miss，不能猜。

## Distribution

涉及文件需要遵守 skill-garden 源优先：

- `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `enhancements/0.6/**`
- 当前 dogfood `.trellis/scripts/**` / `.agents/skills/**`

## Rollback

- 回退 auto-loop/route helper 修改。
- 重新运行 `npm run sync` 让 `enhancements/0.6` 回到源状态。
- 如 dogfood 副本已同步，使用相同源文件重新铺设或手动还原对应副本。
