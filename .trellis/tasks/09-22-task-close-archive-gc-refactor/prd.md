# 重构任务关闭、归档视图与物理 GC

## Goal

重构 Trellis 任务完成与关闭生命周期：把“工作完成”“逻辑关闭”“物理整理”拆成互不混用的状态与动作。任务关闭后立即退出活动视图，Codex/Claude 在 SessionStart 对关闭满 3 天的任务执行物理 GC；整个过程保持 auto-loop、Git 发布、父子任务、跨平台投影与 Flower/Skill-Garden 托管契约一致，并系统删减不再需要的归档提示词。

## Background

当前 `archive` 同时表示任务完结、活动视图移除和目录搬迁，`trellis-finish-work` 又同时承担发布证据判断、决策与 release 审计、归档、日志、提交和推送。该耦合产生了三个直接问题：

- 使用者完成业务工作后仍需让模型显式执行归档，容易遗漏，导致活动任务长期堆积。
- auto-loop 不能在运行中安全移动任务目录或改变 Git `HEAD`，只能额外维护 `pending_archive` 交接态。
- 相同的完成恢复、归档资格和下一步说明散落在 workflow、状态 Hook、多个 Skill、平台命令与测试断言中，持续占用提示词预算并增加漂移风险。

## Requirements

### 1. 生命周期语义

- `task.json.status` 继续只描述工作状态，保留 `planning -> in_progress -> completed` 的既有主链，不再承担目录位置或活动视图语义。
- 任务关闭状态必须与工作状态分离，至少能表达 `pending`、`blocked`、`closed`，并为成功关闭记录稳定的 `closedAt` 时间。
- Git 发布状态、auto-loop 本地提交状态和任务目录位置不得复用 `status` 或关闭状态表达；各读取者必须按自己的证据源判断。
- 新建、旧版、已完成但未关闭、已经逻辑关闭、已经物理归档的任务都必须有明确且可迁移的解释，不能要求用户手工改写历史任务。
- 首次合法的 Codex/Claude SessionStart 必须先执行一次确定性 legacy reconciliation：旧顶层 `planning/in_progress` 补为 `closeout=pending`；旧顶层 `completed` 按当前 Close 结构化条件迁移为 `closed` 或 `blocked`；旧 `pending_archive` 必须结合 runtime 与本地提交证据迁移；旧物理 archive 只解释为 historical closed；损坏或歧义数据只报告、不猜测。
- legacy reconciliation 成功关闭任务时以迁移时刻写入 `closedAt`，不得借用 `completedAt`；迁移变更必须以精确本地 commit 保存、不自动 push，并在同次 SessionStart 的 GC 与状态统计之前完成，使历史任务也获得完整 3 天宽限期。

### 2. Close 行为

- 提供确定性的 Close 入口；正常成功路径不得调用模型。
- Close 只负责验证结构化关闭条件、写入关闭状态与时间、清理指向该任务的活动 Session 指针，并返回结构化结果；不得移动任务目录。
- Close 必须幂等：重复关闭同一任务不刷新 `closedAt`，不重复改写文件，也不制造额外 Git 变化。
- 未达到关闭条件时必须原子失败，并返回可操作的 blocker；决策复核、release 审计、父任务整合或发布恢复等语义工作由对应 owner 处理，Close 不复制其判断提示词。
- 关闭任务必须立即从默认活动视图和活动候选扫描中消失，同时立即出现在 closed 视图中，不依赖物理 GC。
- 重新打开尚未物理 GC 的任务时，必须恢复为 `in_progress`、清除关闭时间并重新进入活动视图；已经物理 GC 的任务必须有显式、可审计且防碰撞的恢复路径。

### 3. 视图与父子任务

- active 必须有唯一共享定义：任务位于顶层且规范化后的 `closeout.status != closed`。因此 `completed+pending/blocked` 仍是 active，`closed` 即使尚未物理 GC 也立即不是 active，物理 archive 永远不是 active。
- 默认 `task.py list`、Codex/Claude SessionStart 摘要与计数、Claude 可选 statusline、进度候选、当前任务 resolver、意图路由和工作流恢复必须全部复用共享 active 数据访问，不得各自按“顶层目录即 active”直接扫描。
- 对 active 列表或计数新增直接目录扫描必须有自动化防回归检查；只有全量索引、legacy reconciliation、closed/all 视图和 GC 等明确需要跨状态读取的 owner 可以使用底层遍历。
- closed 视图必须统一展示尚在顶层目录的逻辑关闭任务与已经移入物理 archive 的任务，并避免重复计数。
- 父子进度、父任务在队列外的情形、父或子先关闭/先 GC 的情形都必须保持可解释；物理目录位置不得被当作唯一的“子任务已完成”证据。
- Close 和 GC 都不得静默丢失父子引用、决策日志、release 文件、任务进度或其他任务制品。

### 4. 物理 GC

- 提供确定性的物理 GC 入口，等价目标为 `task.py gc --closed --before 3d`；GC 不调用模型，不删除任务内容，只把符合条件的目录移动到物理 archive。
- Codex 与 Claude 的 SessionStart 在真实会话 `startup` / `resume` 时触发 GC；`clear` / `compact` 不得重复触发物理整理。
- 仅 `closeout=closed` 且 `closedAt` 已满 3 天的任务可被 GC；缺失、非法或未来时间必须跳过并报告，不能用 `completedAt` 猜测新任务的关闭时间。
- 物理 archive 的分桶规则必须稳定、可重复，目标冲突时禁止覆盖；同一任务在重复 Hook、并发 Session 与中断恢复下必须保持幂等。
- GC 必须使用跨进程锁并在锁内重检资格；允许仓库其他路径存在无关 dirty/staged 变化。候选任务路径必须为 clean，或只包含能够由 auto-loop runtime、已验证本地提交和目标 `task.json` 精确闭合的 runner-owned 完成/关闭 bookkeeping；其他既有差异一律阻断。存在活动 Session 引用、候选任务仍被非终态 auto-loop action 使用、未完成 Git 集成或冲突性目标时，必须跳过对应任务或整批延后；已成功 record 的 completed item、dormant/paused/recent/terminal runtime 不得阻断该任务或无关任务 GC。
- GC 的 Git 提交必须只包含本轮实际迁移的精确 source/destination pathspec，并证明无关 staged/dirty 状态在提交前后保持不变；不得 stage 整个 `.trellis/tasks` 或 archive 根目录。
- legacy reconciliation、GC 与 restore 的精确本地提交在分支引用更新后仍必须完成真实 index 收尾；进程中断或 index 刷新失败时保留可恢复证据，下次重试须清除候选路径的 staged 残留并保持无关 staged/dirty 不变，完成前不得误报成功。
- SessionStart GC 只创建精确本地 commit，不自动 push；因此不以默认分支、upstream 存在或 upstream 同步作为执行前提，后续远端发布由正常 `trellis-push` 统一处理。
- SessionStart 的 GC 输出应默认静默；仅在实际移动、延后或失败时给出紧凑诊断，不能把任务清单和流程说明注入模型上下文。

### 5. Auto-loop

- auto-loop 单项执行期间不得移动任务目录、执行物理 GC、改变既有 commit-only 边界或新增远端副作用。
- 单项仍按既有本地提交与 runner 记录顺序推进；`commit_only` 成功 record 后，应在同一次原子 task bookkeeping 写入中标记工作完成并尝试逻辑 Close，不等待整条 queue 终态。若存在结构化 blocker，则写入 `closeout=blocked` 和 blocker，不伪造 closed。
- 用户在一个 item 成功 record 后暂停、停止或放弃剩余 auto-loop，不得影响这个已完成 item 的关闭与后续 GC；只有“业务看似完成但 commit/record 尚未成功”的 item 仍按未闭合动作恢复，GC 不替 runner 猜测完成。
- 现有 `pending_archive` 必须被更准确的关闭结果或 blocker 汇总替代；终态恢复、recent run、父任务在队列外和 `completed_with_blocked` 都必须有兼容迁移与回归测试。
- SessionStart GC 必须读取 auto-loop runtime：不得移动正在执行且尚未 record 的 candidate item；已经成功 record 为 completed/closed 的 item 即使所属 run 仍在运行、已暂停、已停止或被放弃，也可在关闭满 3 天后 GC。GC 必须兼容该 item 唯一的 runner-owned `task.json` dirty bookkeeping，并将它与目录迁移一起纳入精确提交。

### 6. 工作流与提示词

- 正常交互链路调整为：规划与实现 -> Check-All -> Update-Spec -> Push/记录最终进度 -> 确定性 Close；物理 GC 不属于任务完成链路。
- `trellis-finish-work` 不再是每个已完成任务必须经过的归档模型流程。兼容入口如保留，只能作为薄路由或会话日志入口，不得继续复制完成恢复、Close 或 GC 的详细矩阵。
- workflow hub、workflow-state、SessionStart、`trellis-continue`、`trellis-push`、auto-loop、meta 文档和各平台命令中的 archive/finish-work 重复说明必须删除或改为一跳 owner 引用。
- 确定性解析、迁移、资格校验、锁、错误矩阵和 Git 安全检查必须落在 helper；提示词只保留语义 owner、阻断分流和必要的人机确认。
- 最终编译产物的提示词预算必须相对重构前下降；不得通过新增大型运行时分类器来换取表面上的提示词缩短。

### 7. 兼容、托管与冲突控制

- 旧 `completedAt`、旧物理 archive 与旧 `pending_archive` runtime 必须有明确的数据读取兼容，升级期间不得误判为活动工作或重复搬迁。
- 本次采用硬切换：删除 `task.py archive`、`task.py list-archive`、`trellis-finish-work`、`after_archive` 及其 bundle、Patch、平台命令、提示词和测试契约，不保留 alias、弃用周期或旧行为分支。调用旧入口应自然表现为入口不存在，而不是进入兼容流程。
- 修改必须从 Flower/Skill-Garden 的真实 owner 源完成，并同步 0.6 snapshot、Patch、bundle、平台投影、dogfood 产物与冲突断言；不能只编辑 `.trellis/`、`.agents/`、`.codex/` 或 `.claude/` 生成结果。
- Codex 与 Claude 必须共享同一套 GC 语义；平台差异只能存在于 Hook 注册和标准输出封装。
- Claude 的可选 upstream statusline 必须通过 Flower 受管的 optional-target Patch 接入共享 active 迭代器：未安装 statusline 时安静跳过，已安装但模板漂移或仍绕过共享谓词时验证失败；不得手改 `node_modules`。
- 新旧 Patch 顺序必须经过全排列/受支持顺序验证，重复 apply、sync 和 cachebuster/reinstall 后结果必须一致。
- 重构不得覆盖或回滚仓库中与本任务无关的既有未提交改动。

## Non-Goals

- 不删除历史任务内容，不把 GC 变成不可恢复的永久删除。
- 不在本次重构中改变业务代码提交、普通 push 的确认边界或 auto-loop 的单项实现/检查策略。
- 不引入独立数据库、后台守护进程或新的模型分类服务。
- 不要求用户运行一次性手工迁移，也不重写旧物理 archive；顶层旧任务由首次 SessionStart 的确定性 reconciliation 自动收敛。

## Acceptance Criteria

- [ ] 工作状态、关闭状态、发布证据与物理位置在 schema、CLI 输出、文档和测试中均为独立概念，旧任务可按兼容规则读取。
- [ ] `task.py close`（或最终等价入口）在满足结构化条件时无模型、原子、幂等地关闭任务；失败时不产生部分写入并返回稳定 blocker。
- [ ] closed 任务立即退出默认 active 列表、Codex/Claude SessionStart active 计数、Claude 可选 statusline task 计数、进度候选、当前任务 resolver、意图路由和普通恢复路由，同时出现在统一 closed 视图；这些消费者共享同一 active 谓词，并有禁止旁路扫描的回归保护。
- [ ] 首次 SessionStart 在 GC/状态构建前完成 legacy reconciliation：旧 planning/in_progress 保持 active，旧 completed 与旧 pending_archive 确定性迁移为 closed 或 blocked，旧物理 archive 保持 historical closed，歧义项不猜测；迁移使用当前时刻 `closedAt`、精确本地 commit 且不 push。
- [ ] reopen/restore 覆盖逻辑关闭与已物理 GC 两种状态，并验证时间、目录、Session 指针及目标碰撞行为。
- [ ] `task.py gc --closed --before 3d` 只移动关闭满 3 天的任务，按稳定月份分桶，不覆盖目标；重复、并发、中断和非法元数据场景均有测试。
- [ ] Codex/Claude 只在 SessionStart `startup` / `resume` 触发同一 GC 实现，`clear` / `compact` 不触发；无动作时不增加模型上下文。
- [ ] GC 允许无关 dirty/staged 文件共存，只提交本轮迁移路径；clean candidate 与可验证的 runner-owned `task.json` bookkeeping 均可迁移。对活动 Session、尚未 record 的 candidate action、不可归属 dirty、冲突性目标、Git 集成状态、detached HEAD、分支/upstream 变化和并发锁采取 fail-safe 行为，同时不让已 record completed item 或 dormant/terminal runtime 阻断 GC。
- [ ] legacy reconciliation、GC、restore 的提交后中断与 index 刷新失败均可确定性重试；恢复成功后候选路径无 staged 差异、共享/GC journal 已清理且无关 staged/dirty 与事务前一致。
- [ ] auto-loop 单项路径不移动目录、不新增 `HEAD` 或远端副作用；成功 record 时原子完成并尝试 close，以逐项 close 结果/blocker 取代 `pending_archive`，中途停止 run 不影响已完成 item 的后续 GC。
- [ ] 普通交互完成链路不再要求模型执行归档；决策、release、父任务整合与发布恢复仍由原 owner 在 blocker 出现时按需处理。
- [ ] `trellis-finish-work`、workflow、workflow-state、Continue、Push、SessionStart、auto-loop、meta 与平台命令中的重复归档说明已删除或收敛为一跳引用，严格提示词预算检查通过且最终编译输出净减少。
- [ ] `archive`、`list-archive`、`trellis-finish-work` 与 `after_archive` 已从 canonical source、bundle、Patch、所有平台投影、帮助文本、配置示例、冲突断言和测试中完全删除，不存在兼容 alias。
- [ ] canonical source、0.6 snapshot、Patch/bundle、compiled targets、dogfood 输出、冲突断言和平台注册保持同步，重复 apply/sync 无漂移。
- [ ] Python/JS 单测、Patch 冲突测试、compiled-target check、输出模板扫描和 AI context budget 普通/strict 检查全部通过。

## Notes

- 本任务是跨生命周期、runtime、平台 Hook、提示词与托管投影的复杂重构，必须补齐 `design.md` 与 `implement.md` 后再进入实现。
- 历史上曾尝试以大型完成来源分类器减少提示词，最终因新增约 645 行状态机而撤回；本次必须优先删除重复并复用既有 owner/helper。
