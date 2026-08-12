# 实施计划：任务完成提交与 Check-All 展示顺序

## 1. 核对现有 owner 与最终目标

- [x] 读取 Skill-Garden 0.6 中 `trellis-push`、output templates、Check-All reporting reference、finish-work、continue、completed workflow-state 和 lifecycle meta 的完整相关段落。
- [x] 核对 Patch `patch.json` / Bundle 归属、compiled target 最终文件和当前 dogfood provenance，确认每项改动的唯一 authoring owner。
- [x] 固定现有旧任务 dirty 的内容摘要，后续验证其未被修改。

## 2. 修改普通 Push 完成事务

- [x] 在 `.agents` / `.claude` canonical `trellis-push` 中，把最终任务记录流程改为先调用 `task_progress.py write --complete`，再提交并推送首次确认的 current-task exact files。
- [x] 删除“progress push 后再本地写 completed，并等待 archive commit 承接”的旧语义。
- [x] 明确成功后当前任务文件 clean，retained dirty 原样保留。
- [x] 定义 task-record commit 成功但 push 失败时的 attributable ahead 证据、停止位置和只重试 push 行为。
- [x] 更新 output template 中执行链、结果和恢复说明，避免继续暗示未提交预归档完成态。

## 3. 修改 Completed / Continue / Finish-Work 路由

- [x] 更新 finish-work exact bookkeeping Patch：先用终态 auto-loop `pending_archive.tasks_awaiting_archive` 区分本地-only 完成；仅允许 runner-owned `task.json` progress/lifecycle dirty 进入归档，其它当前任务 dirty 仍阻断。
- [x] 对非 auto-loop completed，归档前检查当前任务是否仍由未推送的可归属 ahead task-record commit 修改；命中则停止并返回 `trellis-push` 恢复。
- [x] 更新 completed workflow-state：只保留一跳判断，区分 auto-loop 本地待归档、普通 task-record push 待恢复与普通已推送可归档完成态。
- [x] 更新 continue recovery：completed candidate 先识别终态 auto-loop handoff；否则按未推送任务记录证据决定 Push 恢复或 finish-work/archive。
- [x] 明确 progress 中的 auto-loop 文本只作诊断，不能单独授权归档、push 或来源判定；证据矛盾时失败关闭。
- [x] 更新 lifecycle meta 文档和必要 owner map，保持“Push owner 负责完成提交与恢复、Finish-Work owner 负责归档”的单一职责。
- [x] 确认 auto-loop runner 的 commit-only、完成态写盘、pending_archive 与 no-push 契约，以及用户 commit-only、partial progress 和 reopen 规则保持不变。

## 4. 消除 Check-All 展示顺序歧义

- [x] 在 `.agents` / `.claude` reporting reference 中把“报告按严重度排序”改为“各通道内部按严重度排序”。
- [x] 明确跨通道始终先 `CHK` 后 `FBK`，禁止 FBK-first、交错展示或因分类顺序改变报告顺序。
- [x] 保留现有模板的主路径/兜底分区、固定问题标题和维度表字段要求。

## 5. 补充契约测试

- [x] 更新 `test/js/workflow-gate-ownership.test.js` 及相关测试，覆盖新完成事务、task-record push 失败恢复和 finish-work 阻断。
- [x] 增加 auto-loop 兼容性断言：内部 commit-only 跳过普通 Step 5/远端 push；终态 pending_archive 可以携带预期 task bookkeeping dirty 进入归档，额外当前任务 dirty 仍阻断。
- [x] 更新 `test/js/check-all-fallback-findings.test.js`，对 `CHK -> FBK` 做真实顺序断言，并断言严重度只在通道内排序。
- [x] 必要时更新 output template、compiled target、dogfood parity 和 context budget 的专项断言。
- [x] 若 `task_progress.py` 无行为变化，保留并运行现有 Python 原子完成测试；若需要改 helper，再补对应失败与恢复用例。

## 6. 同步生成产物

- [x] 运行 `npm run sync`，确认 `enhancements/0.6` 与 vendor source 一致。
- [x] 运行 `npm run patch:targets`，刷新 Skill-Garden canonical compiled targets。
- [x] 通过现有 Flower Plugin 生命周期更新当前 dogfood 受管副本，复核 `.flower/state.json` provenance 和二次 replay 幂等。
- [x] 确认 0.5 / old 快照没有变化。

## 7. 验证

- [x] 运行定向 JS/Python 测试。
- [x] 运行 `npm test`。
- [x] 运行 `npm run patch:targets:check`。
- [x] 运行 `node scripts/check-patch-conflicts.mjs`。
- [x] 运行 `node scripts/check-output-templates.mjs`。
- [x] 运行 `node scripts/check-ai-context-budget.mjs` 和 `--strict`。
- [x] 运行 `git diff --check`，并分别检查父仓与 `vendor/skill-garden` diff。
- [x] 验证既有 `.trellis/tasks/08-11-upgrade-trellis-0-6-14/task.json` 内容摘要未变化。

## 8. 完成态路由去重

- [x] 新增 Push 条件加载 `references/completed-task-recovery.md`，集中保存完成态发布恢复矩阵。
- [x] 将 Finish-Work 收敛为归档资格门禁；非明确可归档状态统一委托 Push preflight。
- [x] 将 Continue、completed workflow-state 和 lifecycle meta 收敛为一跳委托，不再读取或复制 Git/runtime 分类细则。
- [x] 增加 reference 4 KiB 上限、主入口反向去重和多层投影一致性断言；未新增 helper、schema 或预算阈值。

## Review Gates

- Gate A：没有引入第二套 task completion helper、Git orchestrator 或 Patch 协议。
- Gate B：push 失败恢复不依赖聊天摘要或新增 task schema hash 字段。
- Gate C：finish-work 不会归档未推送的当前任务记录 commit，也不会阻断仅与当前任务无关的 ahead 状态。
- Gate D：Check-All 分类顺序保持 `DOC -> FBK -> CHK`，报告顺序固定 `CHK -> FBK`。
- Gate E：vendor source、snapshot、compiled targets、dogfood 和所有平台最终入口一致且幂等。
- Gate F：普通 Push 的 clean/remote-sync 门禁不套用到 auto-loop；auto-loop 仍不 push，且只放行可由终态 pending_archive 与精确 task diff 共同证明的 runner bookkeeping dirty。

## Rollback Points

- 修改 source 但未 sync：直接回退 source 范围，不触碰生成产物。
- 已 sync / compiled：回退 source 后重新运行生成命令，不手工修补快照。
- 已 dogfood update：通过 Flower Plugin lifecycle replay 回退后的 source，保持 state/provenance 一致。
