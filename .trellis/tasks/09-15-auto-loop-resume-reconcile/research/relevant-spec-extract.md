# Auto-Loop 相关规范摘录

来源：`.trellis/spec/flower-trellis/cli/enhancements-model.md`，规划时第 2343—2428 行（2026-09-15）。

仅为避免整份大文件注入截断的任务上下文摘录；原规范为权威，实施前按章节复核当前版本。本任务 design 明确替换原文中的 next/非 Check 漂移终态规则；旧生命周期措辞以当前代码与现行 Auto-Loop Skill 为准，不据此回退 completed 行为。

## Scenario: Auto Loop Unattended Runner

### 1. Scope / Trigger

- Trigger:0.6 `trellis-auto-loop` 接收一次用户启动授权，对显式任务队列完成全量 prepare，
  再无人值守推进到本地 `commit-only` 终态。
- Scope:`auto_loop.py` 负责 schema、manifest、依赖、dirty baseline、预算和 action 状态机；
  `trellis-auto-loop/SKILL.md` 负责语义边界与 action 调度；`decision_log.py` 保存可审计 AI 决策；
  `trellis-push` 独占动态多仓执行链、确定性生成和逐步 Git 安全预检；`trellis-route`、Check-All
  和 `trellis-finish-work` 继续拥有各自完整流程，runner 不执行 Git 或生成命令。

### 2. Signatures

```bash
python3 ./.trellis/scripts/auto_loop.py start \
  --tasks <task> [<task> ...] \
  [--depends-on <dependent>=<dependency>] \
  --profile commit-only \
  [--check-depth auto|light|full] \
  [--route-implement inline|subagent] \
  [--route-check check-all-inline|check-all-subagent]
python3 ./.trellis/scripts/auto_loop.py next [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py record \
  [--task <task>] --action <action> --result <ok|failed|blocked> \
  [--owned-dirty <task>=<repository>::<path>] \
  [--protected-retained <repository>::<path>] \
  [--doc-remediation-file <repository>::<path>] \
  [--files <repository>::<path> ...] \
  [--retained-files <repository>::<path> ...] \
  [--commit <primary-or-last>] \
  [--repo-commit <repository>::<hash> ...] \
  [--commit-message <message>] [...]
python3 ./.trellis/scripts/auto_loop.py decide \
  --task <task> --topic <topic> --option <option> [--option <option> ...] \
  --choice <choice> --summary <summary> --risk low|medium \
  --confidence low|medium|high [--requirement <id>] [--file <repository>::<path>]
python3 ./.trellis/scripts/auto_loop.py retry-blocked [--run-id <run-id>] [--task <task>] [--check-depth auto|light|full] [--route-implement inline|subagent] [--route-check check-all-inline|check-all-subagent] [--all] [--verbose]
python3 ./.trellis/scripts/auto_loop.py status [--run-id <run-id>] [--verbose]
python3 ./.trellis/scripts/auto_loop.py stop --reason "<reason>"

python3 ./.trellis/scripts/decision_log.py status --task <task> --json
python3 ./.trellis/scripts/decision_log.py review \
  --task <task> --verdict accepted|changes-requested \
  [--decision-id <DEC-id>] [--notes <text>]
```

`copy-scripts.js` 必须让 `auto_loop.py` 和 `decision_log.py` 在全装时铺到目标
`.trellis/scripts/`。选择性 `trellis-auto-loop` 与 `trellis-finish-work` 都必须携带
`decision_log.py` 和 archive decision guard，不能只安装 Skill 指针。

### 3. Contracts

- 新 run 写 `schema_version=2`，状态固定为 `preparing -> awaiting_input|running -> completed|completed_with_blocked|globally_blocked|stopped`。schema 1 只兼容读取和恢复既有 action，不自动迁移或降级写回。
- 用户发出 start 指令即授权本次 `commit-only` run。prepare 生成追加式 manifest revision，绑定原始/执行顺序、依赖、profile、route、check depth、repository baseline 及每项 planning/handoff hash；prepare 完成后不得二次确认 manifest。
- prepare 必须扫描全部显式任务后才进入 running。任务状态只允许 `planning|in_progress`；staged、Git conflict、merge/rebase/cherry-pick/revert 等未完成集成在 runtime 创建前全局阻断。
- implement/check route 必须来自 `trellis-route` 校验过的 session runtime、个人 prefs 或用户本次临时选择。runner 不自行猜测 inline/subagent；`check_depth` 与 route mode 相互独立。
- 所有 dirty path 使用 `<repository>::<path>` 唯一键分类为某任务 `owned_dirty` 或 `protected_retained`。分类必须全覆盖、互斥且 hash 未漂移；protected 文件不得被 action 或 commit 使用，每次 record 重新校验内容摘要。
- `## Open Questions` 是人工边界：`- [ ]` 和历史裸列表统一进入整队列 `resolve_open_questions`，run 保持 `awaiting_input`；`- [x]`、空章节或无章节放行。AI 不得代答、删除、改写或勾选，所有问题收敛后才可 record ok。
- planning item 依次执行 `review_planning_readiness`、必要的 `run_planning_repair`、`refresh_brief`。repair 仅处理不改变目标且可由仓库证据确定的问题，单任务最多 3 轮；schema 2 不返回逐任务 `confirm_brief`。
- 依赖只来自 `--depends-on` 或 planning artifacts 的明确契约，不从任务顺序、parent/child 或代码引用猜测。prepare 拒绝缺失、自依赖和循环；稳定拓扑排序只移动满足依赖所需的任务，并把原始/执行顺序写入 manifest。
- AI 只可通过 `decide` 记录任务目标内、低/中风险、可逆且可测试的自主选择。Open Questions、高风险、生产/费用/权限/隐私、破坏性公开契约、push/merge/release/deploy/archive 必须 blocked。
- `decisions.jsonl` 使用 append-only decision/review 事件；decision ID 单调递增，review 绑定当前全部 decision digest。新增 decision 会使旧 review 失效，损坏 JSONL 默认失败关闭。
- decision 修改 planning/handoff 时，`--file` 必须列出全部 `<repository>::<path>`。下一次同任务 record 比较逐文件 hash；全部变化获授权时追加绑定 decision ID 的 manifest revision，否则进入匹配 action 的 artifact drift 处理。
- `next` 发出的 action 必须写入 outstanding 状态；`record` 必须传匹配 action。`run_check_all` / `run_recheck` 的 outstanding action 还要保存 `prd.md`、`design.md`、`implement.md`、`brief.md` 的逐文件 baseline；检查结果必须保存 requested/minimum/effective depth 和原因，minimum/full 不得回写 light。
- Check-All record 以剩余 `CHK-*` 与 `FBK-*` 共同决定 `failed|ok`：任一通道存在问题时必须 `record failed` 并进入 fix/recheck；只有两类问题均为 0 时才能 `record ok`。
- Check-All 自动修复当前任务 `implement.md` 或 `brief.md` 时，每个实际变化文件必须通过重复的 `--doc-remediation-file` 精确声明。声明集合必须与 action baseline 后的真实变化完全一致；`prd.md`、`design.md`、其它任务和其它文件拒绝重绑。合法 DOC 修复重算 planning/handoff hash，追加 `change_source=check-doc-remediation` 和 files 的 manifest revision 与 item audit event。
- 未声明或未完全授权的 Check record artifact drift 返回 `status=retryable`，保持 item running 和原 outstanding action，不得调用 `next`。agent 只能撤回本 action 误改、补充合法 DOC 声明后重录，或用 `--result blocked --failure-type artifact-drift` 明确结束。其它 action、protected drift 和 `next` 发出 action 前的跨 action 漂移继续 terminal blocked。
- 任务级 failure、planning repair 预算耗尽、terminal artifact drift、protected 冲突、spec needs-review 或 commit-only 归属失败只阻塞当前项，并传播到显式依赖项；独立任务继续。队列结束后不自动执行第二遍恢复扫描。
- `fix_recheck` 预算计数表示已记录的 failed recheck 次数；`MAX_FIX_RECHECK=3` 必须实际允许 3 个 `run_fix` action。只有计数大于预算时才以 `retry-budget-exhausted` 阻塞；用户显式 `retry-blocked` 恢复该原因时必须把 `attempts.fix_recheck` 重置为 `0`，避免刚恢复就再次阻断。
- `artifact_reconcile` 只属于同一个 Check outstanding action；`MAX_ARTIFACT_RECONCILE=3` 允许前 3 次 retryable 重录，第 4 次转为 terminal `artifact-drift`。成功 Check record 把计数重置为 `0`；用户显式 `retry-blocked` 恢复 terminal artifact drift 时也重置该预算。
- `retry-blocked` 只重置稳定 recoverable reason，复用同一 run；不得用 `start --force` 替代正常恢复。schema 2 队列含 blocked 项时终态为 `completed_with_blocked`。
- `commit_only` 必须复用 `trellis-push` 内部执行路径。Push 根据当前任务 design/implement、项目 SOP/spec、受版本控制的脚本入口及明确输入输出、可验证的 Git/submodule 关系，动态组织任意数量的 `commit -> generate -> commit`；不得硬编码仓库、命令或步骤数，也不得仅因多个仓库、submodule pin 或证据充分的本地生成而 blocked。
- 生成命令必须来自受版本控制的稳定入口，并能证明工作目录、依赖顺序和预期影响路径；只允许本地、确定性、可重复、无外部副作用的 argv。证据冲突、任意 shell、网络写入、push、发布、部署、归档、凭证或生产数据操作必须在执行前失败关闭。
- Push 在每个 commit/generate 前后重新检查 branch、HEAD、未完成 Git 集成、staged、全部 dirty 和 retained 摘要；只使用 exact paths 和 `git commit --only`，排除 runtime、route prefs、protected paths 及其它任务目录。已登记的 retained 只有在前后内容摘要不变且与 planned/generated paths 不冲突时才可保留，并从生成后的预计文件范围比较中排除；计划外 dirty、未知 staged、retained 漂移、归属歧义或 branch/HEAD 漂移必须在后续副作用前停止。
- 已完成的前置提交不得自动 reset、rebase、revert、amend 或改写。重试时 Push 从真实 Git 状态重新规划，验证已记录 commit 的仓库、对象、message 和文件集合后跳过；确定性生成可以重跑，最终无变化的提交步骤可以跳过。
- `record --repo-commit` 只接受 run 已登记仓库中的 7-64 位十六进制本地 commit object；仓库不可读返回 `repo-commit-repository-unreadable`，同仓同 hash 重复记录幂等，同仓不同 hash 返回 `repo-commit-conflict`。成功、failed 和 blocked 都保留可选 `commits[]`，不提升 schema version。
- `commit` 继续作为主仓或最后提交的兼容字段。存在 `commits[]` 时，显式 `--commit` 必须唯一匹配其中一个已验证完整 hash 或其前缀，否则返回 `repo-commit-primary-mismatch`；未传时使用最后一个 repo commit。没有 `--repo-commit` 的旧单仓 `--commit` 调用保持原行为。
- 只有 Push 已确认现场安全、失败来自确定性生成未收敛或可重新规划的本地预检时，才用 `--result failed --failure-type commit-repairable`。前三次失败保留 commits 并重新发出同一个 `commit_only`，第 4 次以 `commit-repair-budget-exhausted` blocked；`retry-blocked` 重置 `attempts.commit_repair`，但保留已完成 commits。该路径不得复用 Check 的 `status=retryable` 协议。
- item `completed` 只表示本地提交完成，不修改 `task.json.status`。任务继续保持 `in_progress`，直到用户以后显式执行 finish/archive。
- Auto-Loop 内部调用 Push 时跳过 Push Step 5 的任务进度写入、进度提交和 progress push；runner 仍在 item `completed` 或 `blocked` 后写本地 `task.json.progress` 作为恢复提示，但只能使用 `updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes` 五字段 schema。completed progress 有多仓提交时记录 `<repository>:<short-hash>` 列表，blocked progress 保留已完成 commits、失败原因并把 `nextStep` 指向精确 `retry-blocked --run-id <run-id> --task <task>` 命令。该写入不得修改 `task.json.status`、不得触发 push/archive/finish-work、不得保存 push mode、分支或 Git 编排计划。
- `trellis-finish-work` 在归档前运行 Decision Audit；`task.py archive` 在任何状态写入、session 清理或目录移动前再次调用 deterministic review guard。无 decision 放行，当前 digest 未 accepted、changes-requested 或日志损坏时零副作用失败。
- `<run-id>.json` 是 runner 热状态文件，只保留调度和恢复必需字段：当前 queue/item 状态、attempts、blocked reason、commit、outstanding action、manifest revision/hash 和 audit 文件引用。完整 manifest revision 历史必须写入旁路 `<run-id>.manifest.jsonl`，每行是 `type=manifest_revision`、`revision`、`sha256`、`created_at`、完整 `payload` 的审计事件；旧 runtime 中的 `manifest_revisions` 数组在下一次 `_write_state()` 时幂等迁移到 JSONL，并从主 JSON 删除。
- 默认 stdout 只返回 run/action/计数/简短 blocked 与决策摘要；manifest、dirty、依赖链、protected drift、完整 decision data 和 resume capsule 只在 `--verbose` 输出。runtime 继续使用同目录临时文件、flush/fsync 和 `os.replace` 原子写入。
- 默认 `status` / `resume` 不得加载或展示完整 audit JSONL；`--verbose` 最多展示 `manifest_audit_path` 和有限 `manifest_tail`。完整 audit 只在明确 debug artifact-drift 或审计时按路径读取，避免 AI 恢复上下文无脑加载大型内部历史。
- canonical 源位于 `vendor/skill-garden/.trellis/0.6`，经 `npm run sync` 生成快照，再由 enhance-only 更新 dogfood。第二次应用必须为零修改；Auto-Loop Skill 只保留语义边界和 action 调度，确定性 schema/校验/错误矩阵留在 runner/helper。
