# 技术设计：任务完成提交与 Check-All 展示顺序

## 1. 设计概览

本任务包含两个共享发布链的控制面变更：

1. 调整普通 `trellis-push` 的 Step 5，使最终 progress 与 completed 生命周期在任务记录 commit 前一次原子写入，并让 push 失败落在“clean + attributable ahead commit”的可恢复状态。
2. 收紧 Check-All reporting reference，明确分类顺序与展示顺序是两个独立契约，固定跨通道 `CHK -> FBK`。

普通 Push 的新完成事务不得覆盖 auto-loop 的本地终态：auto-loop 仍先完成内部 `commit-only`，再由 runner 写入本地 task progress/lifecycle，并通过终态 `pending_archive` 交给用户显式归档。两项变更都从 Skill-Garden 0.6 authoring source 出发，经 snapshot、compiled targets 和 Flower dogfood 投影验证，不新增第二套生成或写盘机制。

## 2. 生命周期状态与数据流

### 2.1 正常普通 Push

```text
in_progress
  -> business commit/push chain succeeds
  -> task_progress.py write --complete
       writes progress + status=completed + completedAt atomically
  -> exact task-record commit
  -> task-record push succeeds
  -> completed, task files clean, explicit finish-work available
```

`task_progress.py` 已支持一次原子写入完成态，因此优先复用现有 helper，不新增生命周期字段或新命令。

### 2.2 任务记录 Push 失败

```text
task-record commit succeeds
  -> task-record push fails
  -> local status remains completed
  -> worktree remains clean for task files
  -> HEAD contains attributable unpushed task-record commit
  -> finish-work blocks archive
  -> trellis-push verifies and retries only the missing push
```

恢复验证至少使用：

- 当前分支、upstream、HEAD 与 `@{u}..HEAD`；
- ahead commit message 是否匹配当前任务记录提交；
- commit 文件集合是否等于首次确认的当前任务 exact files；
- 当前任务目录是否 clean，`task.json` 是否为合法 `completed + completedAt + final progress`；
- ahead 范围是否只有可归属的已完成业务提交与当前任务记录提交，且没有未知并发漂移。

无法闭合证据时失败关闭，不依赖聊天摘要猜测提交归属。

### 2.3 Finish-Work 门禁

`trellis-finish-work` 在完成状态门禁后只判断当前 completed 是否具备归档资格，不维护普通发布恢复分类：

- 若终态 auto-loop run 的 `pending_archive.tasks_awaiting_archive` 明确包含当前任务，进入 auto-loop 本地归档分支：允许 runner 在本地提交后生成的预期 `task.json` progress/lifecycle dirty，不要求任务记录远端 push；若任务目录还存在其它未提交业务或规划文件则停止归档。
- 否则按普通 Push 完成态检查。只有任务目录 clean、upstream 存在且 `git log @{u}..HEAD -- <current-task-dir>` 无命中时才允许归档；其它状态统一指向 `trellis-push` completed-task preflight，由 Push 判断 commit recovery、push recovery 或阻断。
- 普通 Push 分支只有在任务目录 clean 且没有未推送 commit 修改当前任务时，才继续原 release audit / archive / journal 流程。
- unrelated ahead commit 不应仅因存在而伪装成当前任务记录恢复；原有 bookkeeping 自动 push eligibility 仍独立判断。
- `task.json.progress` 的 `auto-loop` 文本不是生命周期 authority。它只能在 runtime 证据缺失或矛盾时报诊断；不得仅凭该文本跳过 push 门禁或允许归档。
- 无法证明属于上述任一分支时失败关闭，不自动 push，也不归档。

auto-loop 的权威证据复用 runner 已有终态摘要，不新增 task schema 字段：

```text
auto_loop.py status [--verbose]
  -> active/recent terminal run
  -> summary.pending_archive.tasks_awaiting_archive
  -> exact current task match
```

run 终态清除 current pointer 后，`status` 仍会从 recent run summary 返回同一 `pending_archive`，因此 finish-work 不需要从 progress 文本反推运行模式。

### 2.4 Continue 与 Completed Breadcrumb

completed 状态和 Continue 只执行一跳：进入 `trellis-push` completed-task preflight。完整的 auto-loop handoff、task-record commit recovery、push-only recovery、普通已同步和阻断矩阵位于 Push 的条件 reference；preflight 再决定恢复计划、显式 `trellis-finish-work` 或阻断。workflow state、Continue 和 lifecycle meta 不读取 Git/runtime 细则，也不复制分支矩阵。

## 3. Check-All 报告契约

保留现有分类流程：

```text
DOC candidate -> FBK root cause -> CHK root cause -> unresolved risk
```

报告渲染固定为：

```text
DOC auto-remediation section (when present)
-> CHK main-path section (when present)
-> FBK fallback section (when present)
-> uncovered risks / repair batch / next step
```

排序规则拆成两层：

- 跨通道：固定 `CHK` 区块在前，`FBK` 区块在后，禁止交错或反转。
- 通道内部：按严重度 `P0 -> P1 -> P2` 展示；ID 仍保持首次分配，不因排序重新编号。

在 reporting reference 的问题模型和展示规则中各放一条短而直接的约束，并通过测试断言文字顺序及反向禁止语义，避免再次把“分类先判断 FBK”或“全局严重度排序”误解为展示顺序。

## 4. Authoring 与同步边界

### 4.1 Skill-Garden 源

预计修改：

- `.agents/skills/trellis-push/SKILL.md` 与 `.claude/skills/trellis-push/SKILL.md`；
- `.agents/skills/trellis-push/references/output-templates.md` 与 Claude 对应副本，如结果/执行文案仍描述旧顺序；
- `.agents/skills/trellis-check-all/references/reporting-and-disposition.md` 与 Claude 对应副本；
- `overrides/patches/skills/trellis-finish-work/exact-bookkeeping/content.md`；
- `overrides/patches/skills/trellis-continue/task-progress-recovery/content.md` 及必要的 completed route 片段；
- `overrides/patches/workflow/runtime-contract-reference/completed-content.md`；
- `overrides/patches/skills/trellis-meta/managed-workflow-owners/active-task-lifecycle-content.md` 与必要的 owner 文档片段。

若实现检查证明某个 target 已由其它现有 Patch owner 完整承载，则复用该 owner，不新增并行 Patch。

### 4.2 生成与 dogfood

```text
vendor source edits
  -> npm run sync
  -> npm run patch:targets
  -> Flower Plugin lifecycle update/replay current project
  -> compare vendor / enhancements / dogfood
```

不得只编辑 `enhancements/0.6`、compiled targets 或当前 `.agents/.claude/.trellis` 投影。

## 5. 测试设计

### 5.1 契约测试

- 更新 `test/js/workflow-gate-ownership.test.js`：断言普通完成先 `--complete`、再 exact task-record commit/push；断言成功后不保留预归档 dirty；断言 failed task-record push 保留 attributable ahead 并进入恢复门禁。
- 同一组 owner/route 测试断言 auto-loop 内部 `commit-only` 继续跳过普通 Step 5 与远端 push；终态 `pending_archive` 命中的任务允许携带 runner-owned `task.json` bookkeeping dirty 进入显式归档，且其它当前任务 dirty 仍阻断。
- 更新 `test/js/check-all-fallback-findings.test.js`：使用顺序断言固定 `### 主路径问题` 在 `### 兜底问题` 前；断言严重度排序仅限通道内部；断言禁止 FBK-first / cross-channel interleave。
- 如 completed/continue/finish-work 的 Patch 最终产物有独立覆盖，补充或更新相应 Patch/output template 测试。

### 5.2 Helper 测试

- 保留 `test/python/test_task_progress.py` 对 `--complete` 原子写入、失败无半写、session 指针保留和 reopen 的测试。
- 保留 `test/python/test_auto_loop.py` 对 commit-only 后写入本地 completed/progress、`completedAt` 幂等、`pending_archive` 在终态可恢复及 archive guard 解锁的测试；仅当 runtime 摘要契约需要扩展时补用例。
- 只有 helper 返回结构或验证行为变化时才新增 Python 测试；不为纯 Skill 语义重复实现不存在的 Python Git orchestrator。

### 5.3 生成与全量门禁

- `npm run sync`
- `npm run patch:targets`
- `npm test`
- `npm run patch:targets:check`
- `node scripts/check-patch-conflicts.mjs`
- `node scripts/check-output-templates.mjs`
- `node scripts/check-ai-context-budget.mjs`
- `node scripts/check-ai-context-budget.mjs --strict`
- vendor / snapshot / dogfood 目标定向 diff 和 `git diff --check`

## 6. 兼容性与回滚

- 仅修改 0.6 变体；0.5 / old 不变。
- 不新增 task schema 字段，既有 completed 任务仍可由 finish-work 归档。
- 不改变 auto-loop runner 的 commit-only、task progress 写盘或 `pending_archive` 时序；普通 Push 新门禁必须通过来源分流保持兼容。
- 回滚时按相反顺序恢复 Skill-Garden source，再重新生成 snapshot、compiled targets 和 dogfood；不得只回滚生成产物。
- 当前旧任务已经存在的预归档 dirty 不自动迁移或提交，避免本任务修改用户已有状态。
