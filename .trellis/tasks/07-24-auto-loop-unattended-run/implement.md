# Auto-Loop 无人值守执行实施计划

## 1. Canonical Runner 与决策日志

- [ ] 在 `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py` 升级 schema 2，并保留 schema 1 兼容读取。
- [ ] 增加 preparing/awaiting_input/running/completed_with_blocked/globally_blocked 状态与紧凑/verbose 输出。
- [ ] 实现全队列 Open Questions 扫描、planning readiness/repair、brief refresh、manifest revision 和运行前冻结。
- [ ] 增加 task status 白名单，拒绝 review/completed/unknown 等状态进入 implement。
- [ ] 实现显式依赖解析、稳定拓扑排序、循环/缺失/自依赖校验和 `blocked-dependency` 传播。
- [ ] 实现主仓及已初始化子仓的 Git baseline 捕获、dirty 分类 action、protected-retained 校验和全局 Git 阻断。
- [ ] 增加 `decide` 命令，并确保决策、artifact hash 和 manifest revision 一致写回。
- [ ] 保持 Check-All `record + next`、3 轮 fix/recheck、Update-Spec 三态、exact commit-only 和 `retry-blocked` 兼容。
- [ ] 新增 `vendor/skill-garden/.trellis/0.6/scripts/decision_log.py`，提供原子 append/status/review/digest API 与 CLI。

## 2. Skill 与 Workflow 契约

- [ ] 更新 vendor `.agents` / `.claude` `trellis-auto-loop/SKILL.md`：启动即授权、批量 prepare、集中 Open Questions、planning repair、依赖、dirty、决策与新 action 映射。
- [ ] 删除 schema 2 路径的逐任务 `confirm_brief` 要求，同时保留 schema 1 outstanding action 的恢复说明。
- [ ] 明确 AI 决策默认授权范围、高风险黑名单、`decide` 回写和 `decisions.jsonl` 提交归属。
- [ ] 保持 workflow hub/state 只有既有 auto-loop return 优先级，不复制完整 prepare 状态机。
- [ ] 重构而非叠加 Auto-Loop SKILL：把 schema、校验和错误矩阵下沉到 runner/helper，删除被 schema 2 取代的重复正文。
- [ ] 扩展 AI context budget checker/spec，独立测量 compiled full Auto-Loop 最终入口；以 `15,600 bytes / 220 lines` 为基线，设置 `16 KiB` target 和 `18 KiB` review ceiling，且不改变既有 `control-context-total` 公式。

## 3. Finish-Work 与 Archive Guard

- [ ] 更新 vendor finish-work exact-bookkeeping Patch，在 release audit 前加入 Decision Audit。
- [ ] 支持一次接受全部或按 decision ID 请求返工；未审查时停止在归档前。
- [ ] 扩展 task-store-write-integrity Patch，在 `cmd_archive` 的任何副作用前调用确定性 decision review guard。
- [ ] archive guard 对无日志任务放行，对损坏日志、未审查或 changes-requested 默认失败关闭。
- [ ] 更新 Patch conflict/compiled target 断言，覆盖所有平台 finish-work 原生入口。

## 4. 安装与生成链路

- [ ] 更新 `src/lib/copy-scripts.js`，让 `decision_log.py` 随 `trellis-auto-loop` 和 `trellis-finish-work` 选择性安装。
- [ ] 更新 JS 安装测试，覆盖 full、auto-loop-only、finish-work-only、升级和卸载/manifest 路径。
- [ ] 运行 `npm run sync` 生成 `enhancements/0.6` 与 `enhancements/MANIFEST.json`，不手改生成快照。
- [ ] 运行 Skill-Garden compiled targets 生成/检查命令，审查最终 patch 产物。
- [ ] 通过 enhance-only 更新当前 dogfood `.trellis/scripts`、`.agents`、`.claude` 和 patched task/finish-work 入口。
- [ ] 连续执行第二次 enhance-only，确认修改数为 0 且目标文件 hash 不变。

## 5. 自动化测试

- [ ] 扩展 `test/python/test_auto_loop.py`，覆盖 schema 1 兼容和 schema 2 全状态链。
- [ ] 新增 decision log 单元测试：append、ID、digest、review、失效、原子写与损坏文件。
- [ ] 扩展 task store integrity 测试，断言未审查 archive 零副作用阻断。
- [ ] 扩展 finish-work Patch 测试，覆盖 17 平台最终入口的 Decision Audit 语义。
- [ ] 扩展 copy-scripts/selective install 测试，确认两个 skill alias 均携带 helper。
- [ ] 增加多 planning 真实链路场景：批量 prepare、零逐项确认、全部成功、部分 blocked、依赖传播和 protected dirty。
- [ ] 增加 Auto-Loop 最终 SKILL 预算测试，确认默认告警、strict high-warning、compiled target 读取和 baseline delta 输出。

## 6. 验证命令

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/decision_log.py
python3 -m pytest test/python/test_auto_loop.py -q
python3 -m unittest test.python.test_task_store_integrity
npm run sync
npm test
node scripts/check-ai-context-budget.mjs --strict
node scripts/check-snapshot.mjs
git diff --check
```

`node scripts/check-snapshot.mjs` 需要 vendor 源已经提交并更新父仓 submodule pin；实现阶段未提交时允许它因 dirty source 失败，Phase 3.4 前必须重新 sync 并通过。

## 7. Dogfood 验证

```bash
node bin/flower-trellis.js update \
  --target . \
  --enhance-only \
  --variant 0.6 \
  --no-update-check
```

- [ ] 第一次应用后核对 runner/helper/skill/task-store/finish-work 最终副本。
- [ ] 第二次应用修改数为 0。
- [ ] 用临时任务真实运行两组场景，并恢复所有 runtime、route prefs、session pointer 和临时任务：
  - 全 planning 队列：Open Questions 收敛后自动 prepare、稳定重排、全部本地提交。
  - 混合失败队列：前置项 blocked、依赖项 `blocked-dependency`、独立项继续并进入 `completed_with_blocked`。
- [ ] 验证有 decision 的任务不能直接 archive，review accepted 后保持既有归档流程。

## 8. 风险与回滚点

- runner 状态迁移错误：保留 schema 1 fixture；未知 schema 只读报错，不写回。
- prepare action/hash 漂移：所有 record 重算摘要，拒绝 stale action。
- planning 自动修复越权：Open Questions 与高风险黑名单始终走人工/blocked，不允许 `decide` 写 high risk。
- 依赖误判：只接受显式边，不从顺序或 parent/child 推断；manifest 保存证据。
- dirty 文件误提交：启动分类全覆盖、protected hash、commit exact files 三层校验。
- review 被绕过：finish-work 语义门禁与 `task.py archive` 确定性 guard 双层覆盖。
- 生成物漂移：只修改 vendor canonical，重新 sync 和 enhance-only；回滚时恢复 canonical 后重新生成，禁止逐份手改快照。
