# Auto-Loop 无人值守执行技术设计

## 1. 设计目标

本改造保留 auto-loop 现有 `commit-only`、精确 action 回写、Check-All 自动续跑和任务级失败继续能力，把 planning 阶段从“轮到任务时逐项确认”改为“全队列 prepare 后一次进入 running”。

核心边界：

- 用户发出启动 auto-loop 的指令即完成本 run 授权，不再确认生成后的 manifest。
- Open Questions 仍由人工处理，但必须在 running 前集中收敛。
- 其它 planning 问题允许 AI 在边界内自动修复并记录决策。
- running 后只因全局 Git/runtime 安全问题停止；任务级失败进入终态并继续独立任务。
- auto-loop 只做到本地提交，任务保持 `in_progress`，归档仍由 finish-work 显式执行。

## 2. 所有权与文件边界

| 能力 | Policy owner | Runtime owner |
| --- | --- | --- |
| 批量 prepare、manifest、依赖调度、队列终态 | `trellis-auto-loop` | `.trellis/scripts/auto_loop.py` |
| 自主决策语义与风险黑名单 | `trellis-auto-loop` | `auto_loop.py decide` + `decision_log.py` |
| 决策持久化与 review 状态 | `trellis-auto-loop` / `trellis-finish-work` | `.trellis/scripts/decision_log.py` |
| 归档前决策 review | `trellis-finish-work` | `decision_log.py status/review` + `task.py archive` guard |
| 精确本地提交 | `trellis-push` internal commit-only | 既有 Git helper |
| route 执行位置 | `trellis-route` | `route_state.py` |
| 检查深度与检查结果 | `trellis-check-all` | Check-All report + auto-loop record |

不新增通用 Gate controller，不把完整状态机复制到 workflow hub/state。高频层只保留 auto-loop 优先于 interactive stop 的既有边界。

## 3. Runner 状态模型

`SCHEMA_VERSION` 从 1 升级到 2。schema 1 保持兼容读取，旧 `confirm_brief`、`review_open_questions` 和 terminal `blocked` 仍可恢复并按旧 action 完成；新 run 只写 schema 2。

### 3.1 Run 状态

```text
preparing
  -> awaiting_input       # 全队列存在人工 Open Questions
  -> preparing            # 人工更新 artifacts 后重新扫描
  -> running              # manifest revision 已生成
  -> completed
  -> completed_with_blocked
  -> globally_blocked
  -> stopped
```

- `completed`：所有 queue item 已完成本地提交。
- `completed_with_blocked`：不存在 pending/running item，但至少一个 item 为 blocked。
- `globally_blocked`：Git 冲突、未完成集成、仓库不可读或其它无法继续处理任何任务的状态。
- item 的 `completed` 不修改 Trellis `task.json.status`。

### 3.2 Queue item 扩展

在既有字段上增加：

```json
{
  "prepare_status": "pending|repairing|ready|blocked",
  "planning_attempts": 0,
  "planning_sha256": "...",
  "handoff_sha256": "...",
  "manifest_revision": 1,
  "depends_on": [".trellis/tasks/task-a"],
  "decision_count": 0,
  "blocked_by": [],
  "owned_dirty": []
}
```

既有 `attempts.fix_recheck` 继续只管理实现/检查循环；planning repair 使用独立计数，两个预算均为 3。

## 4. Run Manifest

runner 在全队列 prepare 完成后生成 manifest revision。每个 revision 内容确定、带 SHA-256，后续修订以追加 revision 的方式保存，不能覆盖旧摘要。

```json
{
  "revision": 1,
  "created_at": "...",
  "authorization": {
    "source": "user-auto-loop-start",
    "authorized_at": "...",
    "profile": "commit-only"
  },
  "original_order": ["task-b", "task-a", "task-c"],
  "execution_order": ["task-a", "task-b", "task-c"],
  "dependencies": {"task-b": ["task-a"]},
  "route_authorization": {
    "implement": "inline|subagent",
    "check": "check-all-inline|check-all-subagent"
  },
  "check_depth": "auto|light|full",
  "repositories": [{"root": ".", "protected_retained": []}],
  "tasks": [{
    "task": ".trellis/tasks/task-a",
    "task_status": "planning|in_progress",
    "planning_sha256": "...",
    "handoff_sha256": "...",
    "owned_dirty": []
  }],
  "sha256": "..."
}
```

manifest 包含主仓和已初始化子仓/子模块的 dirty baseline。默认输出只展示 revision、摘要、计数和重排提示；完整路径/hash 只在 `--verbose` 返回。

## 5. Prepare 流程

### 5.1 `start`

`start` 继续接收显式任务列表、profile、route 和 check depth，并新增可重复的显式依赖参数：

```bash
python3 ./.trellis/scripts/auto_loop.py start \
  --tasks <task> [<task> ...] \
  [--depends-on <dependent>=<dependency>] \
  --profile commit-only
```

启动时完成零副作用确定性检查：

- 所有任务目录和 `task.json` 可读。
- task status 只允许 `planning` 或 `in_progress`；其它状态结构化拒绝。
- staged 区为空、无冲突、无未完成 Git 集成。
- 捕获各仓 unstaged/untracked 路径和内容摘要。
- 写入 `authorization.source=user-auto-loop-start`，run 进入 `preparing`。

### 5.2 Dirty 分类

存在既有 dirty paths 时，`next` 返回 `classify_dirty_baseline`。AI 按任务归属回写：

- `owned_dirty`: 明确属于某个 queue item。
- `protected_retained`: 无法归属或属于其它工作。

record 时 runner 校验所有 baseline path 被且只被分类一次、路径/hash 未变化、task 位于队列。protected 文件不进入任何提交计划；任务需要修改同一路径时以 `protected-path-conflict` blocked。

### 5.3 Open Questions 批量门禁

runner 每次 prepare 都扫描全部 PRD：

- `- [ ]` 与历史裸列表进入一个批量 `resolve_open_questions` action。
- `- [x]`、空章节或无章节不阻塞。
- action 携带 task、问题文本、来源行和所有相关 PRD hash。
- 主会话按 `trellis-brainstorm` 一次询问一个问题，并在每次用户回答后更新对应 artifacts。
- 所有问题清零后才 record；record 重算全队列摘要，拒绝陈旧结果。

run 在此期间为 `awaiting_input`，不得执行任何 `start_task`、implement 或 commit action。

### 5.4 Planning readiness 与自动修复

对每个 planning item 顺序执行：

```text
deterministic checks
  -> review_planning_readiness
     -> ready: continue
     -> repairable: run_planning_repair
          -> 修改 artifacts / JSONL
          -> 记录 planning repair 与必要 AI decision
          -> 重新 review，最多 3 轮
     -> blacklisted/blocking: item blocked
  -> refresh_brief when missing/stale
  -> compute handoff hash
  -> prepare_status=ready
```

readiness verdict 扩展为 `ready|repairable|blocking`。`repairable` 必须给出问题摘要和证据；`run_planning_repair` 完成后旧 review hash 自动作废。

`refresh_brief` 仅刷新派生视图，不再返回 `confirm_brief`。用户的 start 指令已经提供 run 级授权。

### 5.5 依赖图与稳定排序

依赖仅属于本次 run manifest，不改变通用 task parent/child 数据模型：

- 依赖来自用户显式说明、`--depends-on` 参数，或 artifacts 中明确写出的先后契约。
- 不从任务排列顺序、parent/children 或代码引用自动猜测依赖。
- 依赖必须指向当前队列中的任务；缺失、自依赖、循环依赖在 running 前阻断 prepare。
- 使用稳定拓扑排序；只有依赖约束要求时才移动任务，无依赖节点保持原始相对顺序。
- 重排写入 manifest，并记录 `queue-reordered` 审计事件。

所有 Open Questions 已解决、dirty 已分类、可运行 item 已 ready、依赖图合法后，runner 生成 manifest revision 并进入 `running`。

## 6. Running 流程

### 6.1 启动任务

- planning item 的当前 planning/handoff hash 与 manifest 一致时直接返回 `start_task`。
- in_progress item 直接进入 `run_implement`。
- 无决策事件授权的 artifact 变化以 `artifact-drift` blocked。
- AI 自主决策造成的合法 artifact 变化必须先记录 decision，再生成新的 manifest revision 并绑定该事件。

### 6.2 任务依赖传播

调度 item 前检查 `depends_on`：

- 所有依赖 item completed：继续。
- 任一依赖 blocked：当前 item 直接进入 `blocked-dependency`，保存直接来源和依赖链。
- 独立任务不受影响。

### 6.3 实现、检查与提交

现有链路保持：

```text
run_implement
  -> run_check_all
  -> run_fix / run_recheck（最多 3 轮）
  -> run_spec_update
  -> commit_only
```

- validated auto-loop 的 Check-All 继续 `record + next`，不进入 interactive stop。
- 失败在当前任务内即时重试；预算耗尽后 blocked 并继续队列。
- 队列结束后不进行第二次自动恢复扫描。
- `retry-blocked` 兼容 `completed_with_blocked`，由用户后续显式调用。
- commit-only 计划必须包含当前任务的 `decisions.jsonl`，并继续排除 runtime、route prefs、protected paths 和其它任务目录。

## 7. AI 决策日志

新增 `.trellis/scripts/decision_log.py`，同时提供可导入 API 和 CLI：

```bash
python3 ./.trellis/scripts/decision_log.py status --task <task> --json
python3 ./.trellis/scripts/decision_log.py review \
  --task <task> --verdict accepted|changes-requested \
  [--decision-id <id> ...] [--notes <text>]
```

AI 在 auto-loop 中通过 runner 入口写决策，确保 runtime 与任务文件同步：

```bash
python3 ./.trellis/scripts/auto_loop.py decide \
  --task <task> \
  --topic <topic> \
  --option <option> [--option <option> ...] \
  --choice <choice> \
  --summary <rationale-summary> \
  [--evidence <source> ...] \
  --risk low|medium \
  --confidence low|medium|high \
  [--requirement <id> ...] [--file <path> ...]
```

`decisions.jsonl` 使用 append-only event 模型：

```json
{"schema_version":1,"event":"decision","decision_id":"DEC-0001","run_id":"...","topic":"...","options":[],"choice":"...","summary":"...","evidence":[],"risk":"medium","confidence":"high","requirements":[],"files":[],"planning_sha256":"...","handoff_sha256":"...","recorded_at":"..."}
{"schema_version":1,"event":"review","verdict":"accepted","decision_digest":"...","decision_ids":["DEC-0001"],"notes":"...","reviewed_at":"..."}
```

helper 对整文件执行原子重写，拒绝损坏 JSONL。review 绑定当前全部 decision event 的 digest；新增 decision 后旧 review 自动失效。`changes-requested` 不满足归档门禁。

风险黑名单由 skill 进行语义判断；runner 只允许 `low|medium` 决策写入，黑名单事项必须记录为 blocked reason，不写成已授权 decision。

## 8. Finish-Work 决策审查

`trellis-finish-work` 在 Current Task Release Audit 前增加 Decision Audit：

1. 调用 `decision_log.py status --task <task> --json`。
2. 无 decision 或当前 digest 已 accepted：继续既有 release audit。
3. 有未审查 decision：展示 ID、主题、选择、依据摘要、风险和验证结果，等待一次用户回复。
4. 接受全部：调用 `review --verdict accepted`，继续归档。
5. 指定返工：调用 `review --verdict changes-requested --decision-id ...`，停止 finish-work，返回当前任务处理反馈。

`task.py archive` 增加确定性兜底 guard：存在 `decisions.jsonl` 且当前 digest 未 accepted 时，在任何状态写入、session 清理或目录移动前退出非零。这样直接调用 archive 也不能绕过 review。

## 9. Dirty Baseline 与 Git 安全

- 使用 Git porcelain NUL 输出读取主仓和已初始化子仓/子模块的 staged、conflict、unstaged、untracked 状态。
- baseline 保存路径、仓库根、状态和内容 SHA-256，不保存文件内容。
- `protected_retained` 只作为禁止编辑/提交的证据，不自动加入 planned files。
- 每个 action/commit record 校验相关 baseline；并发修改 protected 文件时保留用户内容并阻塞发生路径冲突的任务。
- staged、冲突、未完成集成是全局阻断；普通 protected dirty 不阻断无关任务。

## 10. 兼容与迁移

- schema 1 state 按现有逻辑恢复；schema 2 才启用 prepare/manifest/decision/dependency。
- schema 1 terminal `blocked` 在 status 中保持原文；schema 2 使用 `completed_with_blocked`。
- `retry-blocked` 同时接受两种 terminal 状态。
- 默认 profile、check depth、route mode、commit-only 授权和 stdout 紧凑原则不变。
- 不迁移历史 task；没有 `decisions.jsonl` 的任务直接通过 archive decision guard。
- 新 helper 通过 script alias 同时随 `trellis-auto-loop` 和 `trellis-finish-work` 精细安装。

### 10.1 Auto-Loop SKILL 体积预算

- 当前 canonical `.agents` / `.claude` 最终入口均为 `15,600 bytes / 220 lines`，作为本次改造基线。
- 在 `scripts/check-ai-context-budget.mjs` 和对应 spec 中新增 Auto-Loop 最终入口测量，读取直接铺设的 canonical variant skill，取 `.agents` / `.claude` 实际入口的最大值；同步测试继续保证快照与 dogfood 一致。
- target 固定为 `16 KiB`，review ceiling 固定为 `18 KiB`；默认模式按既有规则告警，`--strict` 对超过 review ceiling 的结果返回非零。
- Auto-Loop SKILL 不计入现有 `control-context-total` 公式，避免改变既有高频控制面口径，但必须作为独立对象展示 actual、lines、baseline delta 和 status。
- 实现时优先删除或替换旧 `confirm_brief` 和惰性 planning gate 说明；manifest schema、hash 算法、Git 解析、错误矩阵等确定性细节由 runner/helper 自描述，SKILL 只保留 AI 必须遵守的语义边界与 action 映射。
- 不得通过提高 target/review ceiling 消除增长告警；确需超过 target 时必须在检查结果中说明不可去重的新增语义，但最终仍不得超过 review ceiling。

## 11. 发布与同步边界

先修改 `vendor/skill-garden/.trellis/0.6` canonical 源：

- `scripts/auto_loop.py`
- 新增 `scripts/decision_log.py`
- `.agents/.claude` 的 `trellis-auto-loop` skill
- finish-work Patch 内容
- task-store archive guard Patch
- conflicts/bundle 断言和 compiled targets

然后：

1. 在主仓更新 `src/lib/copy-scripts.js` 的 helper aliases 与安装测试。
2. `npm run sync` 生成 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
3. 通过 `node bin/flower-trellis.js update --target . --enhance-only --variant 0.6 --no-update-check` 更新当前 dogfood 副本。
4. 第二次 enhance-only 必须修改数为 0。

## 12. 验证矩阵

### Runner

- 多 planning 任务先全部 prepare，再执行第一个 `start_task`。
- Open Questions 跨任务汇总、hash 失效、人工处理后恢复。
- brief 自动刷新且不再出现 schema 2 `confirm_brief`。
- planning repair ready/三轮耗尽/高风险 blocked。
- manifest 授权、revision、artifact drift 与合法 decision rebind。
- 显式依赖、稳定拓扑排序、循环/缺失/自依赖、依赖失败传播。
- dirty 分类覆盖、protected 冲突、staged/conflict 全局阻断。
- completed/completed_with_blocked、retry-blocked 兼容。

### Decision Log / Finish Work

- decision append、递增 ID、digest、accepted、changes-requested、新 decision 使旧 review 失效。
- 损坏 JSONL 默认失败关闭，旧文件保持不变。
- finish-work 有/无未审查 decision 的分支。
- `task.py archive` 在未审查时零副作用阻断，通过后保持既有 archive 行为。

### 分发与回归

- selective `trellis-auto-loop` / `trellis-finish-work` 都安装 `decision_log.py`。
- vendor、enhancements 和 dogfood runner/skill/helper 一致。
- canonical Auto-Loop 最终入口输出独立预算结果，目标不超过 `16 KiB`，strict 模式不得超过 `18 KiB`。
- Patch conflict、compiled targets、context budget、snapshot 和二次应用幂等。
- 现有 route/check depth/commit-only/atomic runtime 测试保持通过。

## 13. 回滚

- runner schema 2 未投入运行前，可整体回退 canonical runner、skill 和 helper，再重新 sync/apply。
- 已生成 schema 2 runtime 时，回滚版本必须拒绝未知 schema，禁止尝试降级写回；保留 runtime 供升级版本恢复。
- 已写入的 `decisions.jsonl` 是普通任务审计文件，回滚 runner 后继续保留，不删除用户记录。
- finish-work/archive guard 可独立回退，但不得在仍要求 decision review 的发布版本中只移除 guard。
