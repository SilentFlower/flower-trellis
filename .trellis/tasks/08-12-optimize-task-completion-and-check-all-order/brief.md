# Brief — 优化任务完成提交与 Check-All 展示顺序

## Goal

- 让普通 `trellis-push` 把最终 progress 与 `completed` / `completedAt` 一并提交推送，成功后不再遗留本任务产生的 dirty `task.json`；同时固定 Check-All 报告先展示 `CHK-*`、再展示 `FBK-*`。

## Scope

- 调整普通活动任务的 `trellis-push` Step 5：先原子写入最终 progress 与完成态，再创建并推送单个任务记录 commit。
- 定义任务记录 commit 已创建但 push 失败时的 clean ahead 状态、Git 证据验证和只重试 push 的恢复路径。
- 将 completed 的详细恢复分类收敛到 `trellis-push` 条件 reference；`trellis-finish-work` 只保留归档资格门禁，completed workflow-state、`trellis-continue` 和生命周期说明只做一跳委托。
- 复用 auto-loop 终态 `pending_archive.tasks_awaiting_archive` 作为来源证据，让 runner-owned `task.json` bookkeeping dirty 继续进入显式归档，同时阻断其它当前任务 dirty。
- 收紧 Check-All reporting reference：跨通道固定 `CHK -> FBK`，严重度排序只在各通道内部生效。
- 从 `vendor/skill-garden/.trellis/0.6/` 修改真实 source，同步 `enhancements/0.6`、canonical compiled targets 和当前 dogfood 投影，并补齐契约测试。

## Non-Goals

- 不自动执行 `trellis-finish-work`，不把归档合并进普通 Push。
- 不改变 auto-loop runner 的内部 `commit-only`、完成态写盘、`pending_archive`、no-push 时序，也不改变用户 `commit-only`、部分成功、reopen 或 Check-All 分类与风险接受语义。
- 不新增 task schema commit-hash 字段，除非实现证明现有 Git 证据无法安全恢复；该情况必须重新规划。
- 不修改 0.5 / old 变体，不修改 `/root/project/ark` 文件或历史会话。
- 不处理或提交既有 `.trellis/tasks/08-11-upgrade-trellis-0-6-14/task.json` dirty。

## Key Decisions

- 最终 `progress + completed + completedAt` 由现有 `task_progress.py write --complete` 一次原子写入，并进入同一个任务记录 commit；不再在 progress push 成功后制造未提交完成态。
- 任务记录 push 失败时保留本地 commit 和 clean 工作区，通过提交消息、文件集合、任务状态、分支/upstream 与 ahead 范围验证后只重试 push；无法归属时失败关闭。
- `trellis-push` 的 completed-task preflight 是发布恢复唯一详细 owner；低频 Git/runtime 矩阵只在 completed 命中时加载。
- `trellis-finish-work` 只判断是否允许归档：精确验证的 auto-loop handoff 或普通已同步完成态可继续，其它状态返回 Push preflight，不区分 commit recovery 与 push recovery。
- auto-loop 分支只放行 runner 在本地提交后写入的预期 `task.json` progress/lifecycle dirty；其它当前任务 dirty 仍阻断。progress 中的 auto-loop 文本只作诊断，不能单独授权归档或 push。
- 普通 completed 任务不得在仍有未推送当前任务记录 commit 时归档。
- Check-All 的分类顺序继续是 `DOC -> FBK -> CHK`，但报告展示顺序固定为 `CHK -> FBK`；严重度排序不能跨通道反转或交错区块。
- 所有 0.6 改动先落在 Skill-Garden authoring source，再通过既有 sync、compiled target 和 Flower Plugin 生命周期生成投影。

## Key Context

- 当前旧完成链语义位于 `vendor/skill-garden/.trellis/0.6/.agents|.claude/skills/trellis-push/SKILL.md` 的 Step 5。
- `task_progress.py` 已具备 `--complete` 原子写入、失败无半写、completed session 指针保留和 reopen 能力，预计无需新增机器字段。
- `auto_loop.py` 的真实时序是：内部 `commit_only` 成功后先记录 item completed，再由 `_write_state -> _sync_auto_task_progress` 写入本地 task progress/lifecycle；终态和 recent-run status 都保留 `pending_archive`，可作为 finish-work 的来源证据。
- Finish-Work、Continue、completed workflow-state 与 lifecycle meta 由 Skill-Garden Patch owner 管理，不能只编辑当前 dogfood 文件。
- Check-All 歧义位于 `reporting-and-disposition.md` 的“报告按严重度排序”和固定 `CHK -> FBK` 模板之间；`ark` 会话证明模型在已读取 reference 后仍可能选择 FBK-first。
- 当前父仓 dirty 基线只有旧任务的本地完成态，vendor 子仓基线 clean；实现和验证必须保持该旧 dirty 内容不变。
- 当前路由偏好为 inline implement / inline Check-All，Phase 2 直接读取任务三件套与项目规范。

## Risks / Deferred

- 最大风险是把“本地 completed”误当成“远端任务记录已同步”，或反过来把 auto-loop 的本地-only 完成态误判为普通 Push 失败；实现必须先用终态 handoff 区分来源，再使用对应 Git 证据。
- completed breadcrumb 只能保留一跳路由，不能复制完整 Git 恢复算法导致 owner 漂移。
- auto-loop runtime 证据缺失或与 task/Git 状态矛盾时必须失败关闭，不能只凭 progress 文本猜测来源。
- Skill 与 workflow 文本增长需要通过 AI context budget 检查，不能靠提高阈值掩盖重复规则。

## Acceptance

- 普通成功路径提交并推送最终完成态，本任务产生的任务目录变更 clean，retained dirty 原样保留。
- 任务记录 push 失败后保留 attributable local commit 和 clean 工作区；重试不重复业务提交、helper 写入或任务记录 commit。
- Finish-Work 阻止归档普通未推送的当前任务记录 commit，普通已推送 completed 任务正常进入显式归档。
- auto-loop 内部 commit-only 继续跳过普通 Push Step 5 和远端 push；终态 pending_archive 命中的任务允许携带预期 runner bookkeeping dirty 归档，但额外当前任务 dirty 仍阻断。
- auto-loop、用户 commit-only、partial progress、reopen 和既有 task progress 原子性测试继续通过。
- Check-All reference 和测试明确固定 `CHK` 区块在 `FBK` 区块前，禁止 FBK-first 与跨通道交错；通道内按 `P0 -> P1 -> P2` 排序且 ID 不重编。
- vendor source、snapshot、compiled targets、dogfood 与所有平台最终入口一致且幂等；全量测试、Patch conflict、输出模板和 context budget 门禁通过。
- 旧任务 dirty 的内容摘要保持不变。

## Next Step

- Full Check-All 已通过；用户确认继续后进入 `trellis-update-spec`，再由 `trellis-push` 生成精确提交计划。
