---
name: trellis-auto-loop
description: "启动、恢复和推进 Trellis 自动任务循环。用于用户明确要求 auto loop、自动跑任务、/goal 类似流程、一次跑多个任务、继续自动 run、查看/停止 auto-loop，或压缩恢复后需要从 .trellis/scripts/auto_loop.py 读取下一步。"
---

# Trellis Auto Loop

用 `.trellis/scripts/auto_loop.py` 驱动一个接近 `/goal` 的任务循环。Python runner 是状态权威；本 skill 只负责把用户意图映射到 runner 命令，并按 runner 返回的 action 调用现有 Trellis workflow / skill / subagent。

## 核心规则

- 只有用户明确要求自动跑、auto loop、goal-like、继续自动 run、批量任务队列时才启动或恢复；不要把普通实现请求自动升级为 auto-loop。
- 每次开始、恢复、压缩后继续时，先运行 runner 的 `resume` 或 `next`，不要凭聊天摘要推断下一步。
- 每完成一个 action，必须用 `record --action <next 返回的 action>` 精确写回结果；runner 会拒绝缺失或不匹配的 action。写回后立即再调用 `next`，直到 `done`、`blocked` 或需要用户决策。
- 默认 profile 是 `commit-only`：自动推进到本地 commit，不 push、不发布、不归档。
- 多任务只按用户显式给出的任务顺序执行；同一 worktree 不并发。
- route 临时授权写在 auto-loop runtime 中，低于个人 `.trellis/.route-prefs.tmp`；不要写个人偏好。
- planning start gate 会按有效 route 判断 JSONL 是否必需：inline / check-all-inline 可不因 seed-only JSONL 停住；个人默认 subagent 仍优先于 auto inline 授权并要求 curated context。
- 代码提交必须走 `trellis-push` 的 commit-only 语义；不要裸 `git commit` / `git push`。

## 启动

用户给了任务列表时，按原顺序传入；用户只说当前任务时，用 `task.py current --source` 的当前任务。

子代理可用的 workflow 默认写入临时 route 授权：

```bash
python3 ./.trellis/scripts/auto_loop.py start \
  --tasks <task> [<task> ...] \
  --profile commit-only \
  --route-implement subagent \
  --route-check check-all-subagent
```

inline-only 场景改用：

```bash
python3 ./.trellis/scripts/auto_loop.py start \
  --tasks <task> [<task> ...] \
  --profile commit-only \
  --route-implement inline \
  --route-check check-all-inline
```

如果用户个人 `.trellis/.route-prefs.tmp` 存在，`trellis-route` 会优先使用个人偏好；auto 授权只负责 prefs miss 时减少询问。

启动后立即运行：

```bash
python3 ./.trellis/scripts/auto_loop.py next
```

## 恢复

压缩、重开会话、用户说“继续自动跑 / continue auto loop”时：

```bash
python3 ./.trellis/scripts/auto_loop.py resume
python3 ./.trellis/scripts/auto_loop.py next
```

`resume_capsule` 只用于展示；下一步以 `next` 返回的 JSON 为准。

## Action 映射

| runner action | 主 agent 动作 | 成功 record |
| --- | --- | --- |
| `refresh_brief` | 使用 `trellis-task-brief` 生成并展示 brief | `record --action refresh_brief --result ok` |
| `start_task` | 执行返回的 `task.py start ...` 命令 | `record --action start_task --result ok` |
| `run_implement` | 进入 Phase 2.1，先用 `trellis-route(target=implement)` 决定 inline/subagent，再实现 | `record --action run_implement --result ok` |
| `run_check_all` | 进入 Phase 2.2，先用 `trellis-route(target=check)`，执行 check-all | `record --action run_check_all --result ok` |
| `run_fix` | 根据 `last_failure` 修复，复用当前任务 implement route | `record --action run_fix --result ok` |
| `run_recheck` | 复用当前任务 check route，重新 check-all | `record --action run_recheck --result ok` |
| `run_spec_update` | 有代码/测试证据时用 `trellis-update-spec`；无必要更新也 record ok | `record --action run_spec_update --result ok` |
| `commit_only` | 使用 `trellis-push` commit-only auto-loop 预授权路径，只提交当前任务可归属文件 | `record --action commit_only --result ok --commit <hash>` |

失败时写回：

```bash
python3 ./.trellis/scripts/auto_loop.py record \
  --action <action> \
  --result failed \
  --failure-type <type> \
  --summary "<失败摘要>" \
  --files <file> [<file> ...]
```

需要用户产品决策或越权时写回 blocked：

```bash
python3 ./.trellis/scripts/auto_loop.py record \
  --action <action> \
  --result blocked \
  --failure-type <type> \
  --summary "<阻塞原因>"
```

runner 会按 3 轮 fix/recheck 预算决定继续、跳过当前任务或结束队列。

## Commit-Only 预授权

auto-loop 的 `commit-only` profile 是用户对“当前 run 内任务相关本地提交”的一次性预授权。只有同时满足这些条件时，`trellis-push` 可以跳过二次聊天确认：

- `.trellis/scripts/auto_loop.py status` 显示当前 `run_status=running`，且 `outstanding_action.action=commit_only`、`outstanding_action.task` 等于当前活动任务。
- profile 是 `commit-only`。
- 模式是 commit-only，不 push、不 merge、不发布、不归档。
- 提交计划只包含当前任务可归属文件；未识别 dirty 文件保留未提交并写入结果摘要。
- 执行前复核 git 状态仍与计划一致。

如果计划包含未识别 staged 文件、冲突、push/merge/release/archive、真实外部系统或生产数据效果，停止并把当前任务记为 blocked。

## 状态与停止

查看：

```bash
python3 ./.trellis/scripts/auto_loop.py status
```

停止：

```bash
python3 ./.trellis/scripts/auto_loop.py stop --reason "<原因>"
```

## 不要做

- 不要手写或手改 `.trellis/.runtime/auto-loop/*.json`。
- 不要把 `.trellis/.runtime/` 或 `.trellis/.route-prefs.tmp` 加入提交。
- 不要在 auto-loop 外把普通 check 的 post-check stop gate 当成可跳过。
- 不要为模糊需求自动创建任务并开跑；先回到 Trellis planning。
