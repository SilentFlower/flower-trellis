# 当前架构与影响面研究

## 1. 结论摘要

当前问题不是单一的“归档时机”问题，而是一个动作承担了四类职责：

1. `status=completed` 表示业务工作完成。
2. `task.py archive` 校验决策日志、补写时间、清 Session、改父子引用并移动目录。
3. `trellis-finish-work` 用模型判断发布证据、release 审计、auto-loop 例外、日志和 Git bookkeeping。
4. 默认 active 视图直接等同于 `.trellis/tasks/` 顶层物理目录。

因此，任何人漏掉显式 finish-work/archive，任务就会永远留在 active；auto-loop 又不能在运行期安全移动目录，只能产生 `pending_archive`。目标架构应把三类状态拆开：

| 维度 | 权威问题 | 目标 owner |
| --- | --- | --- |
| 工作状态 | 任务是否还需要实现/检查 | `task.json.status` + `task_progress.py` |
| 关闭状态 | 任务是否还应出现在活动工作面 | Close helper / CLI |
| 发布证据 | 本地提交、远端同步或恢复是否成立 | `trellis-push` / auto-loop runtime |
| 物理位置 | 任务目录是否已移入 archive | GC helper / SessionStart Hook |

## 2. 当前写入者

### 2.1 任务创建与工作完成

- `.trellis/scripts/common/task_store.py::cmd_create` 创建 `status=planning`、`completedAt=null`，但没有关闭维度。
- `.trellis/scripts/task.py::cmd_start` 将 `planning -> in_progress` 并绑定 Session 指针。
- `.trellis/scripts/task_progress.py::cmd_write --complete` 原子写入最终 progress、`status=completed`、`completedAt`。
- `.trellis/scripts/task_progress.py::cmd_reopen` 将 `completed -> in_progress` 并清空 `completedAt`。
- `.trellis/scripts/auto_loop.py` 在 runner record 后写入本地 `completed + completedAt`，并维护 `pending_archive` 交接。

### 2.2 当前物理 archive

`.trellis/scripts/common/task_store.py::cmd_archive` 当前顺序为：

1. 只接受顶层活动任务目录。
2. 要求 `status=completed`。
3. 调用 `decision_review_status`，未接受的 AI 决策阻断。
4. 兼容补写缺失的 `completedAt`。
5. 父任务归档时清空仍在顶层的子任务 `parent`。
6. 清除所有指向该任务的 Session 指针。
7. 移动到 `archive/<当前年月>/`。
8. 可自动提交 archive rename 和子任务元数据。
9. 触发 `after_archive` 项目生命周期 Hook。

这说明 archive 不是单纯存储整理，直接重命名或删除命令不足以完成重构。

## 3. 当前读取者

- `.trellis/scripts/common/tasks.py::iter_active_tasks` 仅按“顶层且目录名不是 archive”判断 active。
- `task.py list`、父子进度和多个 Session/Hook 摘要均复用或复制该物理判断。
- `task_progress.py` 会扫描所有顶层 `in_progress/completed` 任务作为恢复候选。
- `task.py list-archive` 只枚举物理 `archive/YYYY-MM`，无法展示尚未移动的逻辑关闭任务。
- `resolve_task_reference` 等解析器只接受顶层活动目录；已物理归档任务缺少统一 restore/reopen 路径。
- 原生 Codex/Claude SessionStart 仍把顶层 completed 任务当 active，并提示显式 archive/finish-work。

## 4. 模型与提示词耦合

重复语义至少分布在：

- `trellis-finish-work` 及其所有平台命令投影；
- `trellis-push/references/completed-task-recovery.md`；
- `trellis-continue` 与 planning/in-progress/completed workflow-state；
- workflow Phase 3.5 与 runtime contract；
- auto-loop Skill、runner `pending_archive` 输出和终态恢复；
- `trellis-meta` 的 task lifecycle、task system、owner routing 文档；
- Codex/Claude SessionStart 与 session context；
- Patch 冲突断言、输出模板和 context budget 测试。

历史会话显示，曾为减少这些重复规则新增完成来源分类器，规模膨胀到约 645 行后被撤回。正确方向是让 helper 输出稳定结果，让提示词只保留一跳 owner 路由。

## 5. SessionStart 与平台投影

- Flower 的 canonical SessionStart 包装器是 `src/assets/flower_session_start.py`，由 `src/lib/flower-assets.js` 投影到 `.trellis/scripts/flower_session_start.py`。
- Codex/Claude 平台注册 owner 分别是：
  - `src/patches/platforms/codex/session-start-hooks/patch.json`
  - `src/patches/platforms/claude/session-start-hooks/patch.json`
- 当前 Trellis SessionStart matcher 是 `startup|clear|compact`；包装器明确跳过 `source=resume`。
- SessionStart 被拆成 `state/rules/stages` 三个 handler，宿主可并行调用；当前仅 state 允许执行原生主入口副作用。
- 因此 GC 不能作为一个与 state 并行且有顺序依赖的独立 Hook。更安全的方案是在唯一 state 副作用路径中先运行确定性 GC，再生成原生状态；resume 只运行 GC，不注入三段上下文。
- Hook 之间不能依赖 Flower update Hook 的执行顺序，GC 必须独立读取当前已部署契约并可重复执行。

## 6. Auto-loop 冲突点

auto-loop 的关键不变量是：单项业务变更由 `trellis-push` 的内部 commit-only 提交，runner 随后 record/next；单项路径不得 push，也不能让额外提交改变待验证的 `HEAD`。

若 Close 仍移动目录或自动提交，就会破坏该不变量。目标行为应为：

- 单项 record 只写工作完成、runner 证据与 Close 结果，不执行目录迁移或额外 Git 动作。
- `commit_only` 成功 record 后，在同一次 task bookkeeping 写入中尝试逻辑 Close；无需等待 queue 整体结束。
- Close 只改任务元数据和 Session 指针，不移动目录、不自行改变 `HEAD`。若语义条件未满足，写结构化 blocker。
- 不能 Close 的项形成结构化 blocker；不再使用“等待人工物理归档”的 `pending_archive`。
- 已 record completed/closed 的 item 不再是运行中工作，即使所属 run 后续暂停、停止或被放弃，也不应阻断 3 天后的物理 GC。
- 只有已经发出、尚未 record 的 candidate action 仍处于 runner 变更窗口，SessionStart GC 必须跳过该 candidate。

当前 auto-loop 会在业务 commit 之后才把最终 progress、`completed + completedAt` 写入 `task.json`，因此会留下一个刻意的本地 bookkeeping diff。新方案若把“candidate path 必须完全 clean”设为绝对规则，这类任务会永久无法 GC。正确兼容是：

- runtime 中 item 已成功 record，且记录的本地 commit 仍可验证；
- candidate 的唯一 dirty 文件是该任务的 `task.json`；
- dirty 内容严格等于 runner 可生成的最终 progress、完成字段和 Close 字段，没有额外键或其他制品变化；
- 满足以上条件时，GC 将该确定性 bookkeeping 与 source/destination 迁移放进同一个精确本地 commit；否则按不可归属 dirty 阻断。

## 7. Git 风险与精确提交边界

物理 GC 移动的是通常受 Git 跟踪的任务目录。精确 pathspec 可以把提交内容与工作区其他变化隔离，因此不需要把“全工作区干净”作为 GC 前提，但不能直接复用当前 archive 提交实现：

- `safe_archive_paths_to_add` 仍会加入整个物理 archive 根目录，可能 stage 其他窗口刚写入的 archive 内容。
- `_auto_commit_archive` 使用普通 `git commit`，若调用前已有无关 staged 文件，仍可能把它们带入提交。
- 仅验证 `git diff --cached -- <本次路径>` 只能证明本次路径有变化，不能证明最终 commit 没夹带其他 staged 路径。

新 GC 应建立独立的 scoped transaction：

1. 锁内固定候选、旧 `HEAD`、当前分支以及无关 staged/dirty 指纹。
2. 要求本轮候选的每个 source/destination pathspec 在迁移前无既有 staged、unstaged 或 untracked 变化；唯一例外是由健康 auto-loop runtime、已验证本地 commit 和目标 `task.json` 内容共同证明的 runner-owned 完成/关闭 bookkeeping。仓库其他路径可以 dirty/staged。
3. 只移动固定候选，并只对精确 source/destination 使用 `git add -A -- <paths>`；禁止 stage archive 根目录。
4. 使用 path-limited commit 语义，避免消费无关 staged 内容。
5. 提交后验证新 commit 的 parent 是固定旧 `HEAD`，文件集合严格等于本轮迁移集合，并验证无关 staged/dirty 指纹保持不变。
6. 任一步失败都不得把无关路径纳入提交；提交前失败应补偿本轮移动，提交后 push 失败则保留并报告精确本地 commit。

精确提交能移除的前提：

- 不要求全工作区 clean。
- 不要求无关 staged 为空。
- 只做本地 commit 时，不要求 upstream 存在或完全同步。

精确提交不能移除的前提：

- 候选 source/destination 自身必须 clean，或只含可由健康 auto-loop runtime 与已验证 commit 精确归属的 `task.json` 完成/关闭 bookkeeping；其他 dirty 无法区分“本轮迁移”与既有任务修改，必须阻断。
- 不能处于 merge/rebase/cherry-pick/revert、unmerged entries 或 detached HEAD 等不安全提交状态。
- 不能用“存在 auto-loop runtime”作为整体阻断。现有 `record --repo-commit` 直接验证指定 commit 对象及同仓哈希一致性，并不要求该 commit 等于当前 `HEAD`。真正的冲突窗口是 candidate item 已发出 Git 动作但尚未 record；已成功 record 的 completed/closed item 即使仍出现在运行中 queue 的历史部分，也已具备稳定证据，可以在到期后 GC。Dormant、paused、recent 或 terminal runtime 同样不应阻断。
- 若要自动 push，仍需验证 branch/upstream/远端基线；pathspec 精确不能证明推送目标和历史拓扑安全。
- 若允许任意功能分支都执行 GC，同一批任务可能在多个长期分支重复迁移并在合并时冲突；需要默认分支单写者约束，或接受“只在当前分支形成精确本地提交、由后续正常合并消解”的产品语义。

因此，提交内容精确与执行时机安全是两个不同问题：前者可以让无关 dirty/staged 共存，后者只保留最小的 Git 集成、非终态 queue/动作窗口和分支拓扑保护。

## 8. 托管源与同步面

本仓库是 Flower/Skill-Garden 自托管项目，必须同时处理以下层级：

1. `vendor/skill-garden/.trellis/0.6/`：0.6 canonical source。
2. `enhancements/0.6/`：发布 snapshot。
3. `src/assets` 与 `src/patches/platforms`：Flower 资产和平台注册 owner。
4. `.trellis/`、`.agents/`、`.claude/`、`.codex/`：dogfood compiled targets，不是唯一修改源。
5. `overrides/conflicts.json`、bundle、compiled-target 与 context budget 测试：防止旧语义被其他 Patch 重新注入。

`trellis-finish-work` 和 `trellis-continue` 的多平台内容主要由 Patch 生成；只修改 dogfood Skill 会在下一次 sync 时被覆盖。

## 9. 建议的兼容基线

- 新任务显式带关闭状态；旧顶层 `completed` 且无关闭字段的任务解释为待关闭，不自动猜成 closed。
- 旧物理 archive 任务按历史已关闭处理，closed 视图可从物理位置兼容读取；不要求搬回顶层补字段。
- 新 GC 只接受显式 `closedAt`，避免错误移动旧 completed 任务。
- 旧 `pending_archive` runtime 可读取并转换成一次 close 候选摘要，但新写入只产出 close 结果/blocker。
- 旧命令入口至少应有一个版本的明确弃用诊断，具体是 alias 到新语义还是保留只读兼容，待产品决策。

## 10. 必须覆盖的验证矩阵

- schema：new/legacy/corrupt/future timestamp/timezone。
- Close：成功、幂等、每类 blocker、写失败补偿、Session 清理失败、reopen。
- 视图：active/closed/physical archive、JSON/text、mine/status、父子混合状态。
- GC：边界时间、稳定分桶、目标碰撞、锁竞争、中断恢复、dirty path、Git unsafe、active Session、auto-loop active/recent。
- Hook：Codex/Claude 的 startup/resume/clear/compact，无动作静默，错误紧凑可见。
- auto-loop：running/paused/stopped/completed/completed_with_blocked/recent recovery、队列外父任务。
- Patch：canonical/snapshot/dogfood 同步、全排列冲突、重复 apply、compiled targets。
- 提示词：旧 archive/finish-work 语义 absent-literal、owner 一跳 required-literal、普通/strict budget 与最终编译输出净减少。
