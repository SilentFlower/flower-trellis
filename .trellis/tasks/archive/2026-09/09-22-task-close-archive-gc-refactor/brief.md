# Brief — 重构任务关闭、归档视图与物理 GC

## Goal

- 将“工作完成、逻辑关闭、交付证据、物理位置”拆成独立维度，让任务 Close 后无需模型归档即可立即退出所有活动视图，并由 Codex/Claude SessionStart 在关闭满 3 天后安全执行物理 GC。

## Scope

- 为 `task.json` 增加 `closeout.pending|blocked|closed`、`closedAt` 与结构化 blockers，并提供确定性、幂等、无模型的 `task.py close`。
- 建立唯一 active 不变量：只有“位于顶层且 `closeout.status != closed`”才是 active；统一 `task.py list`、Codex/Claude SessionStart、公共 session context、Claude 可选 statusline、任务队列、进度恢复、意图路由与当前任务 resolver。
- 为 Claude upstream 可选 statusline 增加 Flower 受管 Patch：未安装时跳过，已安装时复用共享 active 迭代器，模板漂移时 fail closed；不手改 `node_modules`。
- 在首次合法 SessionStart 确定性 reconciliation 旧任务：planning/in_progress -> pending；completed 与旧 pending_archive -> closed 或 blocked；旧物理 archive -> read-only historical closed；损坏或歧义对象只报告。
- 让普通 Push 在最终 bookkeeping 中 Close；让 auto-loop 每个 item 在 `commit_only` 成功 record 后立即尝试 Close，不等待整个 run 结束。
- 提供 `task.py gc --closed --before 3d`：在精确候选范围内移动目录、创建本地 scoped commit、不自动 push，并兼容可验证的 runner-owned `task.json` dirty bookkeeping。
- 将 SessionStart maintenance 固定为：若存在 unfinished GC journal，先恢复且不允许任何新提交；随后 `startup` 执行 reconciliation -> new GC -> state，`resume` 只执行相同 maintenance，`clear/compact` 不执行；从所有 owner 与平台投影中硬删除旧 archive/finish-work 入口及重复提示词。

## Non-Goals

- 不永久删除历史任务内容；物理 GC 仍是可恢复的目录整理。
- 不在 SessionStart 自动 push，不要求默认分支、全工作区 clean 或 upstream 同步。
- 不改变 auto-loop 单项实现/检查与 commit-only 的业务提交边界。
- 不引入数据库、守护进程或大型完成来源分类器；不要求用户手工迁移旧任务，也不重写旧物理 archive。
- 不保留 `archive`、`list-archive`、`trellis-finish-work`、`after_archive` 的 alias、弃用周期或旧行为分支。

## Key Decisions

- `status` 只表达工作状态；`closeout` 只表达是否退出活动工作面；Git/auto-loop 证据与目录位置各自独立。
- `completed+pending/blocked` 仍是 active；`closed` 无论是否已物理 GC 都立即不是 active。所有 active 消费者必须复用共享谓词，并用 source-level guard 禁止以后新增旁路扫描。
- Close、旧任务 reconciliation 和 GC 均由共享 Python helper 确定性执行；模型只处理决策复核、release 风险、父任务整合或交付恢复等结构化 blocker。
- 旧 completed 任务在迁移成功时使用迁移时刻作为 `closedAt`，先精确本地 commit、再进入 GC，因此获得完整 72 小时宽限；证据不清晰时保持 blocked/原状而非猜测。
- auto-loop item 成功 record 后立即写完成与 Close 结果；run 后续继续、暂停、停止或放弃都不影响该 item 满 3 天后的 GC。
- GC 允许无关 dirty/staged 共存；只提交本轮精确 source/destination pathspec，验证 parent/fileset 与无关状态指纹，不 stage archive 根目录、不自动 push。
- reconciliation、GC 与 restore 共用可恢复的精确提交收尾 journal；分支引用更新后必须继续把候选 index 对齐新提交并确认无 staged 残留，刷新失败或进程中断时保留证据供下次重试，无关 staged 必须原样保留。
- 旧物理 archive 仅保留数据读取兼容；旧命令、Skill、Hook 和提示词入口全部硬删除。
- 先修改 Skill-Garden 0.6 canonical，再同步 enhancements、Flower assets/platform patches 与 dogfood compiled targets，禁止只改生成结果或 npm 包缓存。

## Key Context

- 任务目录：`.trellis/tasks/09-22-task-close-archive-gc-refactor/`；完整要求、技术设计和分波计划分别在 `prd.md`、`design.md`、`implement.md`。
- 生命周期核心位于 `.trellis/scripts/task.py`、`common/tasks.py`、`common/task_store.py`、`task_progress.py`、`task_intent.py`、`auto_loop.py`、`common/session_context.py` 和 active Session resolver。
- 当前 Claude statusline 模板来自 upstream `@mindfoldhq/trellis`，其 `_count_active_tasks` 直接扫描顶层目录；正式修复由 Flower optional-target Patch 投影到 `.claude/hooks/statusline.py`。
- Flower SessionStart owner 是 `src/assets/flower_session_start.py` 与 `src/patches/platforms/{codex,claude}/session-start-hooks/patch.json`；三个 SessionStart parts 可并行，只有 state 路径允许副作用。
- `trellis-finish-work`、Continue、workflow-state 与 meta 的多平台内容主要由 Skill-Garden Patch 生成；canonical 位于 `vendor/skill-garden/.trellis/0.6`，`enhancements/0.6` 是 snapshot。
- 当前工作树已有与本任务无关的 dirty 文件和任务目录，实施与同步必须逐文件核对，不能覆盖或回滚。

## Risks / Deferred

- runner-owned `task.json` dirty 只能在 runtime、commit 与目标内容三方完全闭合时随 reconciliation/GC 提交；其他 candidate dirty 必须 fail closed。
- detached HEAD、未完成 Git 集成、目标内容冲突或尚未 record 的 candidate action 会延后对应迁移/GC，但不能阻断 SessionStart 上下文；后续合法 SessionStart 重试。
- `update-ref` 已成功但真实 index 尚未收敛时，不能把事务报告为恢复完成或删除 journal；否则后续普通提交可能误带反向任务变更。
- optional statusline 未安装时不创建该文件；若已安装但上游模板与 selector 漂移，Patch 必须报错，不能静默保留错误统计。
- 历史物理 archive 缺少 `closedAt` 时只作为 historical closed 展示，不反推时间、不参与新 GC。
- release audit 不再是每个 Close 的固定模型步骤；只有上游明确记录 release 风险时才形成 blocker 并路由 `trellis-release`。

## Acceptance

- closed 任务立即退出默认 active 列表、Codex/Claude SessionStart active 计数、Claude 可选 statusline task 计数、任务队列、进度/意图候选、当前任务 resolver 和普通恢复路由，并进入统一 closed 视图。
- active 消费者共享一个谓词；测试覆盖 planning、in_progress、completed+pending、completed+blocked、顶层 closed 与物理 archive，并阻止新增直接目录扫描。
- 首次 SessionStart 在 GC/state 前完成旧任务 reconciliation：旧未完成任务仍 active，符合条件的旧 completed 立即 closed 并退出统计，blocked 继续 active，历史 archive 不改写，歧义项不猜测。
- Close 成功、重复、blocker、写失败、Session pointer、reopen/restore 均有稳定结构化行为和回归测试。
- GC 只处理显式 closed 且满 72 小时的任务，支持 dry-run、锁、幂等、冲突保护、精确本地 commit 和失败补偿。
- GC、legacy reconciliation 与 restore 在提交后中断或 index 刷新失败时均可重试收尾；恢复后候选路径无 staged 残留，无关 staged/dirty 内容与事务前一致。
- auto-loop 已 record completed item 不因 run 继续/暂停/停止而被 GC 阻断；未 record action 不被猜测完成。
- Codex/Claude 仅在 startup/resume 执行 maintenance，无动作零上下文增量，clear/compact 不触发。
- 旧 CLI/Skill/Hook/提示词入口完全不存在，最终 compiled prompt 相对基线净减少。
- canonical、snapshot、Patch/bundle、平台投影、dogfood 与冲突断言一致；聚焦测试、完整 `npm test`、compiled-target check 和 AI context budget strict 全部通过。

## Next Step

- 本任务已启动并进入实施后的质量检查阶段；后续阶段由当前 Trellis workflow-state 与 Check-All 结果决定。
