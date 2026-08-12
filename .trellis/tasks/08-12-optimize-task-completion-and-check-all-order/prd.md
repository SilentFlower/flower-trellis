# 优化任务完成提交与 Check-All 展示顺序

## Goal

优化 Trellis 两处可感知的工作流行为：普通 `trellis-push` 成功后不再遗留仅含 `completed` / `completedAt` 的 dirty `task.json`，并消除 Check-All 对 `CHK-*` / `FBK-*` 展示顺序的歧义。

## Background

- 当前普通 `trellis-push` 先提交并推送最终 progress，再在本地调用 `task_progress.py write --complete`。因此任务进入 `completed` 后，`task.json` 会保留一份未提交的预归档生命周期变更，直到显式 `trellis-finish-work` 归档。
- 用户期望普通成功路径结束时工作区保持 clean，完成态本身也属于任务记录，应进入提交并推送。
- `/root/project/ark` 最近一次 Codex Check-All 报告同时存在 `CHK 2` 与 `FBK 2`，但正文按 `FBK-001/002 -> CHK-001/002` 展示，并省略了固定分区标题和部分模板字段。
- 该报告输出前已经读取当前 `reporting-and-disposition.md`。现有文档一处写“报告按严重度排序”，另一处固定模板为“主路径问题 -> 兜底问题”，存在可被解释为跨通道严重度排序的歧义。
- 当前工作区已有 `.trellis/tasks/08-11-upgrade-trellis-0-6-14/task.json` 的本地完成态 dirty；它属于既有用户变更，不纳入本任务修改或清理范围。

## Requirements

### R1. 普通 Push 原子记录最终完成态

- 普通模式且存在活动任务时，全部业务仓库 commit/push 成功后，使用同一份最终 progress 调用 `task_progress.py write --complete`，一次原子写入 `progress`、`status=completed` 与 `completedAt`。
- 首次确认的当前任务 exact files 必须包含 helper 更新后的 `task.json` 以及计划时已存在且可归属的任务产物。
- 任务记录 commit 必须同时包含最终 progress 和完成态，并在同一次已确认计划内推送；不得在推送成功后再次写入未提交完成态。
- 普通成功路径结束时，本任务产生的当前任务目录变更必须 clean。其它 retained dirty 继续保持原状，不得顺带提交。

### R2. 任务记录 Push 失败可精确恢复

- 若任务记录 commit 成功但 push 失败，保留该本地 commit，不 reset、amend、revert 或制造 dirty 回滚；任务可保持本地 `completed`，但不得被误判为已经可归档。
- 后续 `trellis-push` 必须能够验证该 ahead commit 的仓库、提交消息、文件集合、当前任务归属和完成态，并只重试尚未成功的 push，不重复业务提交、任务记录写入或任务记录 commit。
- 无法证明 ahead commit 属于当前任务记录时继续失败关闭，不得把未知 ahead 当作可恢复完成提交。
- 对普通 Push 完成态，`trellis-finish-work` 在当前任务目录仍被未推送的可归属任务记录 commit 修改时必须停止归档，并指向 `trellis-push` 的任务记录 push 恢复路径。
- 推送成功后，普通 completed 状态继续只指向显式 `trellis-finish-work`；无须再次执行 Update-Spec 或重新生成提交。

### R3. 保持其它完成路径边界

- 部分业务成功、尚无任务记录 commit、用户 `commit-only` 和任务进度写入失败仍保持 `in_progress`。
- auto-loop 内部 `commit-only` 的本地完成态契约保持不变：本地精确提交成功后，runner 再写入 `task.json.progress`、`status=completed` 与 `completedAt`，该 runner-owned bookkeeping dirty 等待用户显式归档，不新增远端 push。
- completed 路由和 `trellis-finish-work` 必须先区分完成来源：终态 auto-loop run 的 `pending_archive.tasks_awaiting_archive` 包含当前任务时，沿用 auto-loop 本地归档路径，不套用普通 Push 的“任务记录 commit 必须已推送、任务目录必须 clean”门禁。
- auto-loop 例外只允许 runner 写入的预期 `task.json` progress/lifecycle 差异；当前任务仍有其它未提交业务或规划文件时继续阻断归档。
- `task.json.progress` 中的 `auto-loop` 文本只作异常诊断，不能单独授权归档、push 或跳过 Git 检查；终态 runtime 证据缺失或互相矛盾时失败关闭，不得猜成普通 Push 或 auto-loop。
- `trellis-finish-work` 仍只负责 release audit、归档、journal 和符合条件的 bookkeeping push，不重新提交业务代码，也不制造完成态。
- `task_progress.py` 现有 `--complete` 原子写入、reopen 和 schema 契约如无需新增机器字段则保持不变。

### R4. Check-All 固定跨通道展示顺序

- Interactive 标准报告在同时存在两类问题时必须先展示 `### 主路径问题` 下的全部 `CHK-*`，再展示 `### 兜底问题` 下的全部 `FBK-*`。
- 禁止因 `FBK-*` 严重度更高、分类时先判断 `FBK-*`、发现先后顺序或 ID 分配时机而把 FBK 区块放在 CHK 前、交错两类问题或省略分区标题。
- “按严重度排序”只允许在各自通道内部生效：每个通道内部按 `P0 -> P1 -> P2` 展示，同时不得重排已经分配的 ID。
- 分类顺序继续保持 `DOC -> FBK -> CHK`；本需求只消除报告展示歧义，不改变根因分类、严重度或风险接受规则。

### R5. Authoring、同步与兼容性

- 0.6 变体先修改 `vendor/skill-garden/.trellis/0.6/` 的真实 authoring source，再运行 `npm run sync` 更新 `enhancements/0.6/`。
- 需要同步更新当前 dogfood `.agents` / `.claude` / `.trellis` 受管副本时，通过现有 Flower Plugin 生命周期完成，不只手改生成结果。
- 更新 Skill-Garden canonical compiled targets，并保持 Flower 与独立 Skill-Garden consumer 的最终语义一致。
- 不改变 0.5 / old 变体，不修改 `ark` 仓库文件或历史会话。

## Acceptance Criteria

- [ ] `trellis-push` 普通任务完成契约明确为：原子写入最终 progress + completed -> 单个任务记录 commit -> push；成功后不再保留本任务产生的 dirty `task.json`。
- [ ] 任务记录 push 失败时，契约明确保留 clean 的本地 ahead commit，并支持验证后只重试 push。
- [ ] `trellis-finish-work` 明确阻止归档仍有未推送当前任务记录 commit 的 completed 任务。
- [ ] completed workflow-state、`trellis-continue` 与生命周期说明能区分“普通任务记录 push 待恢复”“普通已推送可归档”和“auto-loop 本地完成待归档”。
- [ ] auto-loop 内部 `commit-only` 继续跳过普通 Push Step 5 和远端 push；runner 写入的预期 task bookkeeping dirty 不被新门禁误判，用户 `commit-only`、部分成功和 reopen 行为也没有被扩大或破坏。
- [ ] Check-All reference 明确规定跨通道固定 `CHK -> FBK`，严重度仅在通道内排序，并包含禁止 `FBK -> CHK` 的反向约束。
- [ ] JS/Python 契约测试覆盖新的完成态提交、push 失败恢复、finish-work 阻断和 Check-All 顺序规则。
- [ ] `vendor/skill-garden/.trellis/0.6`、`enhancements/0.6`、canonical compiled targets 与当前 dogfood 结果保持一致。
- [ ] `npm test`、`npm run patch:targets:check`、Patch conflict 检查、输出模板检查和 AI context budget 检查通过；新增条件加载 reference 不通过提高预算阈值掩盖体量变化。
- [ ] 既有 `.trellis/tasks/08-11-upgrade-trellis-0-6-14/task.json` dirty 保持原内容和状态，不被本任务提交或回滚。

## Out Of Scope

- 自动执行 `trellis-finish-work` 或把归档合并进普通 `trellis-push`。
- 修改任务 JSON schema 以保存 commit hash，除非实现阶段证明无法用现有 Git 证据安全恢复；出现该情况必须回到规划评审。
- 改变 Check-All 的 `CHK-*` / `FBK-*` 分类定义、严重度尺度、风险接受或 DOC 自动修复边界。
- 清理 `ark` 当前工作区、重写其历史报告或修改已有会话日志。
