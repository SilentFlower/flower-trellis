# 技术设计：任务 Close、Closed 视图与 SessionStart GC

## 1. 设计目标

本设计把当前混合在 archive/finish-work 中的职责拆为四个正交维度：

| 维度 | 权威数据 | 负责回答的问题 |
| --- | --- | --- |
| 工作状态 | `task.json.status` | 是否还需要规划、实现或检查 |
| 关闭状态 | `task.json.closeout` | 是否仍属于活动工作面 |
| 交付证据 | Git 与 auto-loop runtime | 提交/推送/本地 runner 证据是否闭合 |
| 物理位置 | 顶层或 `archive/YYYY-MM/` | 是否已经完成目录整理 |

正常链路变为：

```text
planning -> in_progress -> completed
                              |
                              v
                    deterministic Close
                              |
                    closed view immediately
                              |
                SessionStart + closedAt >= 3d
                              |
                    exact local GC commit
```

Close 与 GC 都是 Python 确定性能力，不调用模型。模型只处理 Close 返回的语义 blocker；物理位置不参与语义判断。

## 2. 数据模型

### 2.1 新任务 schema

`task.json` 新增：

```json
{
  "status": "planning",
  "completedAt": null,
  "closeout": {
    "status": "pending",
    "closedAt": null,
    "blockers": []
  }
}
```

约束：

- `closeout.status` 只允许 `pending | blocked | closed`。
- `closedAt` 只在 `closed` 时存在，使用秒级 UTC ISO 8601，例如 `2026-09-22T08:00:00Z`。
- `blockers` 是稳定对象数组；每项至少包含 `code`、`owner`、`message`，可带结构化 `detail`。
- `pending/blocked` 时 `closedAt=null`；`closed` 时 `blockers=[]`。
- `completedAt` 继续表示工作完成日期，不用于计算 GC 年龄。

### 2.2 旧数据兼容读取

- 顶层旧任务缺少 `closeout`：在 reconciliation 成功前内存中解释为 `pending`，避免升级瞬间把未判定任务从 active 视图移除。
- 旧物理 archive 任务缺少 `closeout`：closed 视图中解释为 historical closed，`closedAt` 可显示为 unknown；目录已物理整理，不参与新 GC，也不回写历史文件。
- 旧 `pending_archive` runtime：只用于 reconciliation 识别 runner-owned `task.json` 完成差异；新 runtime 不再写该字段。
- 非法 `closeout`、损坏 JSON 或证据歧义必须暴露诊断并保持原文件，不以 `completedAt`、目录日期或顶层位置猜测 closed。

### 2.3 首次 SessionStart reconciliation

reconciliation 不依赖一次性全局版本标记，而是在每次合法 `startup/resume` 中幂等扫描仍缺少新 schema 的对象；没有候选时为零写入。单个候选规则如下：

| 旧对象 | 迁移结果 |
| --- | --- |
| 顶层 `planning/in_progress` | 显式补 `closeout=pending`，继续 active |
| 顶层 `completed` 且满足 Close 条件 | `closeout=closed`，`closedAt=迁移时刻` |
| 顶层 `completed` 且存在结构化 blocker | `closeout=blocked`，保留 blocker 并继续 active |
| 旧 `pending_archive` | 校验 runtime、record 与本地 commit 后迁移为 closed 或 blocked |
| 旧物理 archive | 仅按 historical closed 读取，不改写、不重新 GC |
| 损坏或歧义对象 | 跳过并报告，不猜测 |

- reconciliation、GC 与 restore 共用精确 Git 事务能力；只 stage 实际候选路径，不纳入无关 dirty/staged 文件，不自动 push。共享事务在 `commit-tree` 后、`update-ref` 前持久化收尾 journal，引用更新后还必须把真实 index 的候选路径对齐到新提交并验证无残留 staged，才能报告成功。
- 一批迁移必须先完成候选计算，再原子写入并创建 scoped local commit；提交前失败回滚本批写入，不能留下半迁移 schema。
- `closedAt` 使用迁移时刻，所以刚迁移的历史 completed 任务不会在同次 SessionStart 被 GC，并获得完整 72 小时恢复窗口。
- 如果 detached HEAD、Git 集成态、候选路径 dirty 无法归属或提交验证失败，则延后 reconciliation；SessionStart 仍按兼容读取生成上下文，下一次合法会话重试。

## 3. Close 契约

### 3.1 CLI 与共享 helper

新增：

```text
task.py close <task> [--resolve-blocker <code>] [--json]
```

CLI 只封装共享 `evaluate_close` / `apply_close` helper。普通 Push 与 auto-loop record 直接复用 helper，不复制资格矩阵。

结构化结果：

```json
{
  "status": "closed | already-closed | blocked | error",
  "task": ".trellis/tasks/<task>",
  "closedAt": "<timestamp|null>",
  "blockers": []
}
```

### 3.2 资格与 blocker

Close 在写入前统一计算：

1. `status=completed`；否则 `work-not-completed`。
2. 决策日志不存在或当前 digest 已 accepted；否则 `decision-review-required` / `decision-log-invalid`，owner 为 `decision_log.py` 与人工复核。
3. 父任务的已声明 children 均能解析且已完成；否则 `open-children` / `missing-child`。子任务关闭不依赖父任务关闭。
4. 调用方声明的结构化语义 blocker 仍未解决时保留，例如 `release-review-required`、`parent-integration-required`。
5. 普通完成或 auto-loop 完成的交付证据由既有 owner 先闭合；Close 不重新实现完整 Git 恢复分类器。显式 CLI 遇到模糊交付证据时返回 `delivery-recovery-required`，由 `trellis-push` 处理。

release audit 不再是所有任务关闭时的固定模型步骤。Check-All、任务规划或 Push 已明确记录 release 风险时，才以结构化 blocker 路由 `trellis-release`；其余任务不为证明“无 release”额外调用模型。`needs-review` 是否阻断由产生该 blocker 的 owner 决定，GC 不解释 release 内容。

持久化语义 blocker 在重复 Close 时必须保留；所属 owner 完成对应工作后，可通过共享 helper 的
`resolved_blocker_codes`，或由用户显式重复传入 `--resolve-blocker <code>` 解除。可重新计算的 blocker
不接受该参数绕过，而是每次按当前任务事实重新判断。

### 3.3 写入与幂等

- 所有 blocker 在任何写入前完成计算。
- blocker 存在时原子写入 `closeout=blocked` 与完整 blocker 集；重复结果不改文件。
- 无 blocker 时原子写入 `closed`、首次 `closedAt` 和空 blockers。
- 已 closed 重试返回 `already-closed`，不刷新时间。
- 成功关闭后清理所有指向该任务的 Session pointer；resolver 同时把“pointer 指向 closed task”视为 stale，以覆盖崩溃窗口。
- 新项目生命周期事件只保留 `after_close`；在 Close 成功后 best-effort 执行，失败不回滚已关闭事实。
- `after_archive` 完全删除；物理 GC 不借用 Close Hook。

### 3.4 普通与 auto-loop 接入

- 普通交互：`trellis-push` 在最终进度/任务记录提交中调用共享 Close helper，把完成状态、Close 结果和 Session journal 纳入同一份精确 task bookkeeping 计划；遇到 blocker 时停止在对应 owner，不进入物理整理。
- auto-loop：`commit_only` 成功 record 后，在同一次 `task.json` 原子写入中记录 progress、`completedAt` 与 Close 结果；不移动目录、不创建额外 commit、不 push。
- auto-loop item 一旦成功 record 为 completed/closed，即使 run 后续继续、暂停、停止或被放弃，也不再阻断该 item 的 GC。
- 已发出但尚未 record 的 candidate action 仍属于运行中变更窗口，不能 Close/GC 猜测其结果。

## 4. 任务视图与解析

### 4.1 数据访问层

扩展共享 task data access，提供：

- `iter_task_records`：遍历顶层与历史物理 archive，返回位置与规范化 closeout。
- `iter_active_tasks`：只返回 `closeout.status != closed` 的顶层任务。
- `iter_closed_tasks`：返回顶层逻辑 closed 与历史物理 archive，并按任务目录身份去重。
- `resolve_active_task_reference`：只接受未关闭顶层任务。
- `resolve_task_reference`：按调用场景显式选择 active/closed/physical 范围，禁止模糊同名。

共享不变量为：`active = top-level AND normalize(closeout).status != closed`。它与 `task.json.status` 无关，因此 `completed+pending/blocked` 仍需留在活动面处理 blocker，而 `closed` 在目录尚未 GC 时也立即退出活动面。

以下消费者必须调用 `iter_active_tasks` / `resolve_active_task_reference`，不得自行遍历顶层目录计数或选候选：

- `task.py list` 与 task queue；
- Codex/Claude SessionStart 状态、计数和公共 `session_context`；
- Claude 可选 statusline 的当前任务行与 `N task(s)`；
- `task_progress.py`、`task_intent.py`、Continue、workflow-state 与 Session pointer resolver。

增加 source-level 防回归测试：上述 active consumer 若出现新的 `.trellis/tasks` / `tasks_dir.iterdir()` 直接扫描即失败。全量索引、reconciliation、closed/all 视图和 GC 通过窄 allowlist 使用底层遍历。

默认 `task.py list` 只显示 active。新增：

```text
task.py list --closed [--mine] [--json]
task.py list --all [--mine] [--json]
```

`--closed` 是统一 closed 视图，不是旧 `list-archive` 的 alias。

### 4.2 父子任务

- Close 与 GC 都保留 `parent` / `children` 原始关系，不再因目录移动清空 child.parent。
- 父子进度通过全量 task index 计算，以工作/关闭状态为准，不再把“顶层缺失”直接推断为完成。
- active 视图中若父任务已 closed，仍活动的 child 作为顶层可见项展示，并保留 `parent` 信息。
- 物理 archive 中的父子引用可被 closed/all 视图解析；碰到缺失或同名冲突必须诊断，不静默改写。

## 5. Reopen 与 Restore

- 扩展现有 `task_progress.py reopen`：逻辑 closed 且仍在顶层时，原子执行 `completed -> in_progress`、`completedAt -> null`、`closeout -> pending`。
- 对已经物理 GC 的任务，新增显式 `task.py restore <task> [--json]`，精确反向移动到顶层；目标存在时阻断。
- restore 只恢复物理位置，不自动重开工作状态；用户随后显式 reopen，避免一次命令同时改变存储与业务状态。
- restore 使用与 GC 对称的精确本地提交事务，不自动 push。

## 6. 物理 GC

### 6.1 CLI

新增：

```text
task.py gc --closed --before 3d [--dry-run] [--json]
```

- `--closed` 为显式安全选择器。
- `--before` 使用严格 duration parser；默认 Hook 固定传 `3d`，边界为 `closedAt <= now - 72h`。
- `--dry-run` 输出同一资格计算，不移动、不 stage、不 commit。
- 新 archive bucket 使用 `closedAt` 的 UTC `YYYY-MM`，保证重复执行目标稳定。

### 6.2 单次执行流程

1. 获取 `.trellis/.runtime/task-gc.lock` 跨进程锁；锁忙即静默跳过或返回结构化 busy。
2. 锁内重扫任务与当前时间，筛选显式 closed、时间合法且满 3 天的顶层任务。
3. 排除活动 Session 仍引用的任务，以及 auto-loop 已发出但尚未 record 的 candidate item。
4. 固定每个 source/destination、旧 `HEAD`、当前分支与无关 staged/dirty 指纹。
5. 候选允许两类基线：完全 clean；或唯一 dirty 为可由健康 auto-loop runtime、已验证本地 commit 与目标内容闭合的 runner-owned `task.json` 完成/Close bookkeeping。
6. 目标不存在时移动；目标已存在且身份/内容完全一致时按幂等 no-op；其他同名目标阻断，绝不覆盖。
7. 用隔离临时 index 从固定旧 HEAD 构造本轮精确 source/destination tree；通过 `commit-tree`
   创建提交对象，原子写共享提交收尾 journal，再用固定分支引用与预期旧 HEAD 执行 `update-ref` CAS。
8. 验证 commit parent、文件集合、rename/add/delete 内容与无关 staged/dirty 指纹；按精确 pathspec
   把真实 index 对齐新提交，确认候选路径无 staged 残留后清共享 journal；不 push。
9. 提交前失败时补偿本轮移动；引用更新后的中断或 index 刷新失败保留共享 journal，下一次
   maintenance/同命令重试补齐 index 收尾，不 reset/rewrite 已生成提交，也不丢失无关 staged。

### 6.3 Git 最小门槛

不要求：

- 全工作区 clean；
- 无关 staged 为空；
- 默认分支；
- upstream 存在或同步。

仍要求：

- attached branch，避免自动创建仅由 detached HEAD 引用的提交；
- 不处于 merge/rebase/cherry-pick/revert 或 unmerged 状态；
- candidate path 可精确归属；
- auto-loop 没有与 candidate 重叠的未 record Git 动作。

## 7. SessionStart 接入

### 7.1 执行位置

不增加一个与现有 state handler 并行竞争的独立 GC Hook。Flower 的三个 SessionStart part 可并行，只有 state part 允许副作用，因此：

- `src/assets/flower_session_start.py` 的 state 路径先恢复 unfinished GC journal，再依次运行
  reconciliation、new GC，最后生成原生 SessionStart 状态。
- `startup`：unfinished GC recovery -> reconciliation -> new GC -> state，使中断事务先闭合，
  旧任务迁移与 active 数量在首屏立即准确。
- `resume`：运行相同 maintenance，不重复注入 state/rules/stages 内容。
- `clear` / `compact`：不运行 GC，继续原有上下文刷新。
- Codex/Claude 注册 matcher 增加 `resume`，但 rules/stages 在 resume 直接 no-op。

GC 无动作时 stdout/context 零增量；仅 actual move、deferred、error 产生短 `systemMessage`/stderr 诊断，完整明细留给 JSON/日志而不是模型上下文。

### 7.2 平台与托管 owner

- Flower asset owner：`src/assets/flower_session_start.py` 与资产投影清单。
- Codex/Claude 注册 owner：`src/patches/platforms/*/session-start-hooks/patch.json`。
- Claude 可选 statusline 来自 upstream Trellis 模板，Flower 不修改 `node_modules`；新增受管 Patch 以 `.claude/hooks/statusline.py` 为 `missing=skip` 目标，将其任务计数替换为共享 `iter_active_tasks`。文件未安装时跳过，文件存在但 selector 漂移时 fail closed，防止更新后悄悄恢复错误统计。
- Trellis lifecycle/helper owner：Skill-Garden 0.6 scripts/Patches。
- 先改 `vendor/skill-garden/.trellis/0.6` canonical，再同步 `enhancements/0.6`，最后生成 dogfood targets。
- SessionStart Patch 不依赖 update Hook 顺序；重复 apply 与两平台输出必须幂等。

## 8. 工作流与提示词重构

### 8.1 删除

硬删除以下入口和所有投影：

- `task.py archive`、`task.py list-archive`；
- `trellis-finish-work` Skill、bundle、所有平台 command/skill；
- `after_archive` 配置、文档与 Hook 触发；
- auto-loop `pending_archive` 新写入；
- workflow/Continue/Push/SessionStart/meta 中“显式归档”“等待 finish-work”的重复矩阵。

旧命令不提供 alias 或专用弃用处理，由 argparse/Skill 不存在自然失败。

### 8.2 新 owner 分配

| 语义 | 唯一 owner |
| --- | --- |
| Close 资格、blocker schema、幂等写入 | 共享 Close helper |
| 正常完成与交付恢复 | `trellis-push` + 既有 Git evidence |
| auto-loop 单项完成/Close | `auto_loop.py record` |
| 决策复核 | `decision_log.py` / 人工确认 |
| release 风险 | Check-All / `trellis-release`，仅在显式信号时 |
| 物理整理与精确 commit | GC helper |
| 会话触发 | Flower SessionStart state part |
| closed/active/all 展示 | shared task data access + `task.py list` |

workflow hub 与 workflow-state 只保留一跳路由。Phase 3.5 不再要求模型归档；Push/auto-loop 返回 Close 结果后流程即完结。Session journal 在普通 Push 的最终 task bookkeeping 中记录；auto-loop journal 只在 runner 自身已有终态记录点生成，不作为 Close/GC 前提。

## 9. 失败与并发模型

- Close：资格先算完再原子写 task.json；Session pointer stale 可由 resolver 自愈。
- 精确提交：reconciliation、GC 与 restore 共用 `.trellis/.runtime/task-maintenance-commit.json`；
  `update-ref` 成功后仍须修复并验证真实 index，只有 commit、目录/文件内容、候选 staged 与候选外
  指纹全部一致才清 journal。进程中断或 `index.lock` 失败保留原证据并允许确定性重试。
- GC：全局进程锁防本工作树并发；目录移动 journal 在任何新提交前恢复，且只在共享提交收尾
  成功后清理；固定分支引用、预期旧 HEAD 的 CAS 与 path manifest 防分支切换和并发提交漂移。
- 多分支：closedAt bucket 与目标路径稳定，相同历史在不同分支产生相同文件移动；不自动 push，交由正常合并处理。
- 多 worktree/clone：每个工作面独立执行；目标冲突采用内容/身份比对，绝不覆盖。
- Hook timeout：GC 超时或失败不能阻断 SessionStart 上下文，返回紧凑诊断并留待下次重试。
- 非法 closeout/时间/runtime：fail closed；不以 `completedAt` 或目录日期猜测。

## 10. Rollout 与回滚

这是入口硬切换但数据非破坏性：

- rollout 同一变更内完成 core helper、CLI、auto-loop、Hook、提示词与平台投影，避免半套语义。
- 首次合法 SessionStart 对旧顶层任务执行一次幂等 schema reconciliation，但不搬迁刚关闭任务；旧物理 archive 保持原位且不改写。
- 回滚代码时，新字段会被旧版本忽略，物理 archive 仍是旧版本可读目录；已生成的 GC commit 可通过普通 Git 历史审计，不执行自动 reset/revert。
- 发布前必须验证旧入口完全 absent、新入口完整 required、Patch 任意受支持顺序不重新注入旧文案。

## 11. 被拒绝的替代方案

- Close 时立即移动目录：重新耦合语义与物理位置，继续干扰 auto-loop。
- 每次 Close 调模型：重复现有 finish-work 问题。
- SessionStart 只移动不提交：污染工作区。
- 要求全局 clean/default branch/upstream synced：超出精确本地 commit 的真实需要。
- auto-loop 整体活跃即禁用 GC：会错误阻塞已 record completed item。
- 新增大型完成来源分类器：历史上已证明增加状态机体积与漂移，改用现有证据 owner + 小型共享 helper。
- 保留 archive/finish-work alias：延长双语义期并继续占用提示词，本次明确硬删除。
