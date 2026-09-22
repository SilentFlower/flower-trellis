# 实施计划：任务 Close、Closed 视图与 SessionStart GC

## 0. 基线与边界

- [ ] 记录当前 dirty 文件、submodule 状态、compiled-target baseline 与 AI context budget baseline；后续不得覆盖既有无关改动。
- [ ] 固定旧入口/文案全仓清单与 owner 映射，区分 canonical、snapshot、Patch、compiled target、dogfood、测试和文档。
- [ ] 为 `status/closeout/physical location/auto-loop runtime` 建立表驱动测试夹具，先覆盖 legacy 与 corrupt 输入。

验证：

```bash
git status --short
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
```

## 1. Closeout schema 与共享数据访问

- [ ] 在 canonical Patch/source 中为新任务加入 `closeout={pending,null,[]}`，补齐类型、加载、校验和规范化 helper。
- [ ] 重构 task data access：统一 active/closed/all/physical 遍历与去重，消除各脚本复制的“顶层即 active”判断。
- [ ] 将 `task.py list`、SessionStart/session_context、task queue、`task_progress.py`、`task_intent.py`、Continue 与 active Session resolver 全部改为共享 active 谓词；closed pointer 必须按 stale 自愈。
- [ ] 新增 Claude 可选 statusline 的 Flower 受管 Patch：目标不存在时跳过，存在时将当前任务解析与 task count 接入共享 active 数据访问；上游 selector 漂移必须报错。
- [ ] 增加 active consumer 旁路扫描防回归检查，只对白名单中的全量索引、迁移、closed/all 与 GC owner 放行。
- [ ] 让父子进度读取完整 task index，以状态而非目录缺失判定完成；保留 parent/children 引用。
- [ ] 实现 legacy 只读解释：顶层 missing closeout -> pending；物理 archive -> historical closed。

验证：schema 单测、legacy/corrupt/duplicate identity、父子混合位置、各 active consumer/计数一致性、statusline installed/absent/drift、旁路扫描 guard、text/JSON view fixtures。

## 2. Legacy reconciliation

- [ ] 实现缺少新 schema 对象的幂等 reconciliation planner：planning/in_progress -> pending，completed -> Close evaluator 的 closed/blocked，旧 pending_archive -> runtime/record/commit 证据校验结果，旧物理 archive -> read-only historical closed。
- [ ] 对 corrupt/ambiguous 对象输出稳定诊断且不写入；迁移 closedAt 固定使用本批迁移时刻，不借用 completedAt。
- [ ] 复用 maintenance 锁与精确 Git transaction，把本批实际 `task.json`/runtime bookkeeping 写入一个 scoped local commit；不 push，并在提交前失败时恢复原文件。
- [ ] SessionStart 若存在 unfinished GC journal，先于任何新提交恢复；随后让 reconciliation 先于 new GC 与 state 构建。无候选零输出，Git 条件不满足时安全延后并在下次合法会话重试。

验证：所有旧状态矩阵、混合成功/blocker/corrupt 批次、重复运行、写入/提交失败补偿、unrelated dirty/staged 保持、迁移后 active count、同次 GC 的 72h 宽限。

## 3. Close、Reopen 与 Restore

- [ ] 新增共享 Close evaluator/result schema 与原子 writer。
- [ ] 实现 `task.py close <task> [--resolve-blocker <code>] [--json]`、`after_close`、幂等时间与 Session pointer 清理/自愈。
- [ ] 将决策日志、children、显式语义 blocker 与交付歧义映射为稳定 blocker code；不复制模型恢复矩阵。
- [ ] 扩展 `task_progress.py reopen` 处理顶层 logical closed。
- [ ] 实现 `task.py restore`，对物理 archive 做防碰撞的精确反向移动与本地 commit。
- [ ] 增加 `task.py list --closed/--all`；默认 list 与恢复候选排除 closed。

验证：Close success/already/blocked/error、写失败、stale pointer、Hook failure、reopen/restore/collision、父子门禁。

## 4. 普通 Push 与 Auto-loop 接入

- [ ] 普通 `trellis-push` 最终 task bookkeeping 改为调用共享 Close helper，并将 closeout、最终 progress 与 Session journal 纳入既有精确提交/推送边界。
- [ ] auto-loop `commit_only` 成功 record 的同一次 task.json 写入增加 Close 结果，不新增 commit/push/目录移动。
- [ ] 用逐项 `close_result` / `close_blockers` 替换新 runtime 与输出中的 `pending_archive`；旧 runtime 仅保留读取迁移。
- [ ] completed/closed item 与 run 的 running/paused/stopped/abandoned/terminal 状态解耦；只有尚未 record action 阻断 candidate GC。
- [ ] 保持现有多仓 commit 证据、重试预算、recent run 与 parent-outside-queue 行为。

验证：auto-loop 全状态矩阵、中途停止、队列继续、record 崩溃恢复、runner-owned task.json dirty 归属、普通 completed recovery。

## 5. GC 与精确 Git 事务

- [ ] 实现严格 duration/UTC closedAt 解析、稳定 bucket、candidate manifest 和 dry-run JSON。
- [ ] 实现跨进程 GC 锁、Session/auto-loop candidate 检查、目标 identity/content 幂等比较。
- [ ] 实现 clean candidate 与 validated runner bookkeeping 两种允许基线。
- [ ] 新增只接受精确 source/destination 的 Git transaction；禁止 archive root pathspec，保留无关 staged/dirty 指纹。
- [ ] 实现临时 index + `commit-tree` + 固定分支 `update-ref` CAS、parent/fileset/rename 验证与提交前补偿；绝不自动 push/reset/rewrite。
- [ ] 为 reconciliation、GC、restore 的共享提交层增加 `commit-tree` 后收尾 journal；引用更新后必须修复并验证真实 index，成功后才清 journal，刷新失败保留重试入口。
- [ ] 接入 `task.py gc --closed --before 3d [--dry-run] [--json]`。

验证：72h 边界、非法/未来时间、批量 move、重复 GC、identical/conflicting destination、锁竞争、detached/integration state、auto-loop bookkeeping、失败补偿、最终引用更新窗口切分支；并在 GC 中断/index 刷新失败、legacy reconciliation 与 restore 场景断言候选 staged 清零、无关 staged/dirty 保持不变。

## 6. Codex/Claude SessionStart

- [ ] 在 Flower state side-effect 路径调用 maintenance：startup/resume 先恢复 unfinished GC，再运行 reconciliation/new GC；startup 随后构建 state，clear/compact 均不运行。
- [ ] 更新 Codex/Claude SessionStart matcher 与 resume no-output 逻辑，保持 state/rules/stages 并行契约。
- [ ] 将 no-op 保持为零上下文；move/deferred/error 只输出紧凑诊断。
- [ ] 验证 update Hook 与 GC 无顺序依赖、30 秒 timeout 下可恢复。

验证：两平台四种 source、并行 parts、native output schema、超时/异常降级、GC 中断与 legacy migration 组合恢复，以及 GC 后 active count/statusline count 准确。

## 7. 硬删除旧入口与提示词收敛

- [ ] 删除 task CLI `archive/list-archive`、旧 archive helper/auto-commit、`after_archive` 文档与触发。
- [ ] 删除 `trellis-finish-work` bundle/Patch/Skill/所有平台投影与生成清理规则。
- [ ] 删除新写入 `pending_archive` 及 archive/finish-work 终态提示。
- [ ] 重写 workflow Phase 3、workflow-state、Continue、Push、SessionStart、meta/release 文档为 Close/GC 一跳 owner。
- [ ] 增加 absent-literal 冲突断言，防其他 Patch 重新注入旧入口和旧提示词。
- [ ] 对最终 compiled outputs 做重构前后字符/字节 diff，证明常规提示词净减少。

验证：全仓旧字面量白名单扫描、output template scan、普通/strict context budget。

## 8. 托管源同步与 Patch 冲突

- [ ] 先完成 `vendor/skill-garden/.trellis/0.6` canonical scripts/Patches/bundles/conflicts。
- [ ] 同步 `enhancements/0.6` snapshot；更新 Flower assets/platform patches。
- [ ] 运行生成流程更新 `.trellis/.agents/.claude/.codex` dogfood targets，不手改遗漏。
- [ ] 更新 plugin/marketplace/cachebuster 所需元数据，确保安装/重装获得相同结果。
- [ ] 验证重复 apply/sync、受支持 Patch 顺序、compiled targets 与 conflict assertions。

验证：

```bash
npm run sync
npm run patch:targets:check
npm run test:patch-conflicts
```

实际脚本名以 `package.json` 为准；若不存在单项命令，使用 `npm test` 中对应阶段。

## 9. 全量验证与审查门

- [ ] 运行 Close/view/reopen/restore/GC/SessionStart/auto-loop 的聚焦 Python/JS 测试。
- [ ] 运行完整 `npm test`，包括 compiled targets、Patch conflicts、output templates 与 context budget。
- [ ] 运行 `node scripts/check-ai-context-budget.mjs --strict` 并记录重构前后结果。
- [ ] 全仓扫描确认旧入口只允许出现在迁移研究/历史 fixture 白名单，不存在可执行入口或常规提示词。
- [ ] 检查实际 git diff 与任务 PRD/design/implement 的正反向覆盖，确认无关既有 dirty 未被改写。
- [ ] 通过 Check-All 后才进入提交计划；若任一 owner 投影漂移，回到对应 wave 修复并重跑。

## Rollback Points

- Wave 1-3：schema/view/reconciliation/Close 可整体回退 Patch；reconciliation 只产生可审计字段变更，不搬迁目录。
- Wave 4：auto-loop schema 写入切换必须与读取兼容同批落地，失败回退新写入、保留旧读取。
- Wave 5-6：GC/Hook 在平台注册前可独立关闭；已生成 commit 不自动 reset/revert。
- Wave 7-8：旧入口硬删除必须与新 workflow/compiled targets 原子发布，不能只恢复提示词而不恢复运行时。
