# Auto loop task runner 技术设计

## Goal

设计一个接近 `/goal` 语义的 Trellis auto runner：用户显式启动后，由 Python 脚本持久化控制流程，按单任务或显式多任务队列持续推进到本地 `commit-only`，并在上下文压缩后可靠恢复。

## Architecture

### 边界分工

- Python runner 是流程控制权威来源，负责队列、锁、当前任务、phase/step、尝试次数、blocked、commit-only 进度、resume capsule 和下一步动作。
- Trellis workflow 仍是语义步骤来源，runner 不新增平行 workflow，只把现有 Phase/gate 变成可恢复的状态机。
- agent 负责实际理解、实现、检查、修复和总结；runner 不直接写业务代码，也不替代 agent 判断。
- `trellis-route` 仍负责 implement/check 执行模式选择；auto 只提供临时 route 授权，减少交互打断。
- `trellis-push` 的 commit-only 语义仍负责本地提交边界；auto runner 不执行 push、发布或归档。

### 文件位置

- runner 脚本优先落在 `.trellis/scripts/auto_loop.py`，公共逻辑可放入 `.trellis/scripts/common/auto_loop.py`。
- auto runtime state 放在 `.trellis/.runtime/auto-loop/<run-id>.json`，该目录属于 gitignored 临时状态。
- 当前 session route state 仍使用 `.trellis/.runtime/sessions/<context-key>.json`。
- 用户个人 route 偏好仍使用 `.trellis/.route-prefs.tmp`，auto 不写入该文件。
- `trellis-auto-loop` skill 是 agent 侧入口，负责触发、恢复、action 映射和 `record` 回写协议；runner 仍是状态权威。
- 涉及 0.6 强化包时，源文件先改 `vendor/skill-garden/.trellis/0.6/`，再运行 `npm run sync` 同步 `enhancements/0.6/`，必要时同步当前 dogfood `.agents` 副本。

## State Model

`auto-loop/<run-id>.json` 使用版本化 schema，建议字段：

```json
{
  "schema_version": 1,
  "run_id": "20260628-001",
  "status": "running",
  "profile": "commit-only",
  "created_at": "2026-06-28T00:00:00Z",
  "updated_at": "2026-06-28T00:00:00Z",
  "queue": [
    {
      "task": ".trellis/tasks/06-28-example",
      "status": "pending",
      "current_step": "planning",
      "attempts": {
        "fix_recheck": 0
      },
      "last_failure": null,
      "commit": null,
      "blocked": null
    }
  ],
  "current_index": 0,
  "route_authorization": {
    "implement": "subagent",
    "check": "check-all-subagent"
  },
  "resume_capsule": {
    "current_task": ".trellis/tasks/06-28-example",
    "next_action": "run_implement",
    "must_read": [
      ".trellis/tasks/06-28-example/prd.md",
      ".trellis/tasks/06-28-example/design.md",
      ".trellis/tasks/06-28-example/implement.md"
    ]
  }
}
```

`resume_capsule` 是人类可读摘要，不是权威状态。压缩恢复后必须先调用 runner 的 `resume` / `next` 命令，由脚本读取完整 state 并返回下一步。

runner state 还保存 `last_action` / `outstanding_action`。`next` 发出 action 时写入，`record` 必须显式传入同一个 action；缺失或不匹配时返回 error，避免 agent 写回错动作后静默推进。

## Command Interface

第一版 runner 命令面：

- `start --tasks <task>... [--route-implement <mode>] [--route-check <mode>]`：创建 auto run，按显式顺序写入队列。
- `resume [--run-id <id>]`：读取当前或指定 run，输出当前队列、当前任务和可恢复摘要。
- `next [--run-id <id>]`：计算下一步动作，返回结构化指令，例如 `start_task`、`run_implement`、`run_check`、`run_fix`、`commit_only`、`skip_blocked`、`done`。
- `record --run-id <id> --result <ok|failed|blocked> ...`：记录 agent 执行结果、失败摘要、验证命令、修改文件和下一步。
- `status [--run-id <id>]`：展示队列进度、completed/blocked/pending 列表。
- `stop --run-id <id> [--reason <text>]`：停止 auto run，不删除状态文件。

命令输出默认应是精简 JSON，便于 agent 可靠解析；需要排查时再提供 verbose 输出。

## Flow

### 单任务

1. `planning` 任务：runner 检查 start gate。
2. gate 满足：调用 `task.py start`，进入 `in_progress`。
3. 调用 `trellis-route`，route helper 先读 session state，再读个人偏好，再读 auto 临时授权。
4. 执行 implement。
5. 执行 check-all。
6. 失败则进入 fix/recheck，最多 3 轮；同类失败或无进展可提前 blocked。
7. 通过后执行 spec update 判断；有明确代码/测试证据时可自动写入。
8. 自动执行 commit-only，每个任务一个 commit。
9. 任务完成后进入队列下一个任务。

### 多任务队列

- 用户一次性显式指定多个任务，runner 按给定顺序执行。
- 同一 worktree 内不并发跑多个任务。
- 某个任务 blocked 时，记录 blocked 原因、失败摘要和可恢复下一步，然后跳过继续后续任务。
- 每个成功任务独立 commit-only，不把多个任务混成一个提交。
- 最终汇总 completed、blocked、skipped 和 commit 列表。

## Route Authorization

auto 临时 route 授权不是个人偏好，也不由 profile 直接覆盖 route。`route_state.py resolve` 的优先级应为：

1. session runtime route state
2. `.trellis/.route-prefs.tmp` 个人偏好
3. `.trellis/.runtime/auto-loop/<run-id>.json` 里的 auto 临时授权
4. 交互询问

auto 临时授权命中后，`route_state.py` 应写回当前 session runtime，使压缩后恢复仍复用合法 route 决策。新增 source 可命名为 `auto-loop`，并纳入合法来源校验。

planning start gate 也按有效 route 判断 JSONL 是否必需：个人 `.route-prefs.tmp` 优先于 auto 临时授权；inline / check-all-inline 可不因 seed-only JSONL 停住，subagent 路径仍要求 curated context。

## Commit-Only

- auto 可以自动本地 commit，但禁止 push、发布、归档。
- 用户显式启动 `trellis-auto-loop --profile commit-only` 是本次 run 内任务相关本地提交的预授权；普通 `trellis-push` 不受该例外影响。
- `trellis-push` 只能在 runner `status` 显示 `run_status=running`、`profile=commit-only`、`outstanding_action.action=commit_only` 且任务匹配时使用预授权。
- commit 前必须尽量自动归属任务相关文件。
- 可归属文件进入本任务 commit；无法归属的 dirty 文件不提交，并写入任务结果摘要或 blocked 备注。
- 提交信息由任务标题、实现摘要和 Trellis 语义生成；多任务队列每个任务单独提交。

## Blocked Rules

runner 应尽量少停顿。只有下列情况进入 blocked：

- 需要用户产品决策，且无法从 PRD/design/implement/code/spec 推断。
- start gate 不满足，例如复杂任务缺 `design.md` / `implement.md` 或 JSONL 上下文未 curated。
- dirty worktree 无法归属，且会影响当前任务 commit-only。
- 连续失败达到 3 轮，或同类失败重复且没有实质进展。
- 继续执行会越过本次 `commit-only` 授权边界，例如 push、发布、归档、真实外部系统或生产数据操作。

安全、凭证、发布、外部系统等词本身不触发停顿；只有实际操作越权或无法本地模拟/验证时才停。

## Compatibility

- 不修改官方 `@mindfoldhq/trellis` 全局安装目录或 `node_modules`。
- 不绕过 Trellis task artifacts、spec 注入、route gate、check-all 和 commit-only 语义。
- 仅最小扩展 `route_state.py` 的解析来源和优先级，不重写 `trellis-route` 流程。
- `auto-loop` runtime 和 `.runtime/sessions` 都是 gitignored 状态，不进入提交。
