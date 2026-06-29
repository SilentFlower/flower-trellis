# Brief — Auto loop task runner

## Goal

- 为 flower-trellis / skill-garden / Trellis 设计并落地一个接近 `/goal` 语义的 auto runner：用户显式启动后，由 Python 脚本持久化控制流程，按单任务或显式多任务队列持续推进到本地 `commit-only`，并在上下文压缩后可靠恢复。

## Scope

- 新增 Python runner 作为流程控制权威来源，维护任务队列、当前任务、phase/step、尝试次数、blocked 状态、commit-only 进度、resume capsule 和下一步动作。
- 支持一次性显式指定多个任务，按用户给定顺序逐个执行；每个任务独立走 `planning -> task.py start -> implement -> check -> fix -> recheck -> commit-only`。
- blocked 任务默认记录原因后跳过，继续后续任务，最终汇总 completed/blocked/skipped 和 commit 列表。
- 默认 `commit-only` profile 完全自动：自动 start、implement、check-all、fix/recheck、必要 spec update 和本地 commit；不自动 push。
- 通过 `.trellis/.runtime/auto-loop/<run-id>.json` 保存 auto runtime state 和临时 route 授权；压缩恢复后必须先调用 runner 的 `resume` / `next`。
- 新增 `trellis-auto-loop` skill 作为 agent 入口，承接触发、恢复、action 映射、`record` 回写和 commit-only 预授权说明；Python runner 仍是状态权威。
- 最小扩展 `route_state.py`：route 解析优先级为 session runtime route state -> `.trellis/.route-prefs.tmp` 个人偏好 -> auto 临时授权 -> 交互询问。
- 修改 skill-garden 0.6 强化内容时必须先改 `vendor/skill-garden/.trellis/0.6/` 源，再同步 `enhancements/0.6/`，必要时同步当前 dogfood `.agents` 副本。

## Non-Goals

- 不自动 push、发布或归档。
- 不在同一 worktree 内并发跑多个任务。
- 不自动把模糊需求创建成可执行任务并直接开跑。
- 不绕过 Trellis 原有 task artifacts、spec 注入、route gate、check-all 和 commit-only 语义。
- 不修改官方 `@mindfoldhq/trellis` 全局安装目录或 `node_modules`。

## Key Context

- 任务文档：`prd.md`、`design.md`、`implement.md`。
- 关键新状态路径：`.trellis/.runtime/auto-loop/<run-id>.json`。
- 现有 route 状态：`.trellis/.runtime/sessions/<context-key>.json`。
- 用户个人 route 偏好：`.trellis/.route-prefs.tmp`，auto 不写入该文件。
- 预计 runner 入口：`.trellis/scripts/auto_loop.py`；公共逻辑可放入 `.trellis/scripts/common/auto_loop.py`。
- 关键风险文件：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/scripts/route_state.py`、同 `.claude` 副本、`enhancements/0.6/**`、当前 `.agents/skills/trellis-route/scripts/route_state.py`。

## Acceptance

- 形成并实现 Python runner 的 `start`、`resume`、`next`、`record`、`status`、`stop` 命令。
- 支持单任务和显式多任务顺序队列。
- 支持压缩恢复：runner state 是权威来源，resume capsule 只作摘要。
- 支持默认 3 轮 fix/recheck 预算和 blocked 后跳过继续队列。
- 支持每个任务成功后独立 commit-only，且不 push。
- 支持 auto 临时 route 授权，不污染 `.trellis/.route-prefs.tmp`。
- 支持 `--skills trellis-auto-loop` 精细安装时同时铺设 skill 与 `.trellis/scripts/auto_loop.py`。
- 通过计划中的语法、快照、diff 和 task validate 检查。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `python3 ./.trellis/scripts/task.py start 06-28-auto-loop-task-runner`，随后进入 Phase 2.1 implement route。
