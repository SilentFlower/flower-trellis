# Trellis Python 控制面语义边界实施计划

## 1. Patch 与资产准备

- [x] 从 `node_modules/@mindfoldhq/trellis` 0.6.5 模板提取 task.py、active_task.py、paths.py、task_store.py 的精确 selector/baseline。
- [x] 在 vendor 现有 brainstorm planning-handoff Patch 中加入 Open Questions checkbox 收敛契约。
- [x] 扩展现有 task-start-brief-gate Patch，加入 F3 start 状态写入、pointer 失败补偿和 hook 门禁。
- [x] 扩展现有 state-missing-task Patch，加入 F4 structured clear result、task.py finish 和 paths.py 结果传播。
- [x] 新建 task-store write-integrity Patch，覆盖 F6 create、双文件关系、set-* 和 archive 关键状态。
- [x] 新建 runtime-state-integrity Patch，覆盖上游 active_task session runtime 的原子写、损坏诊断和 fallback 边界。
- [x] 为新增 Patch 配置唯一 operation ID、Bundle 归属和 conflicts.json 最终产物断言。

## 2. Skill-Garden 自有资产

- [x] 修改 vendor `auto_loop.py`：checkbox parser、历史 review action/hash/cache、runtime 原子写与损坏恢复。
- [x] 同步修改 vendor `.agents` / `.claude` 的 trellis-auto-loop Skill，记录 review action 的 AI 判断和回写协议。
- [x] 修改 vendor `.agents` / `.claude` 的 route_state.py：F2 task membership 与 F7 corrupt session fail-closed。
- [x] 修改 vendor `task_intent.py`：`autoDiscardEligible` 必须验证 active task 真实绑定。
- [x] 修改 vendor `task_progress.py`：新增 invalidCandidates/scanWarnings 诊断。
- [x] 保持 `.agents` / `.claude` 对应源逐字节一致。

## 3. 行为测试

- [x] 扩展 auto-loop 测试：unchecked/checked/空/无章节/TBD/历史已解决/真实未决/ambiguous/hash stale/retry。
- [x] 扩展 route 测试：同 run task 命中、跨 task miss、completed item miss、正常 fallback 保留。
- [x] 扩展 start/finish 测试：首次写失败、pointer 失败补偿、补偿失败、降级模式、unlink 失败、hook 不执行。
- [x] 新增 task store 测试：重复 slug、create 写失败、parent 双写补偿、set-* 写失败、archive 状态写失败。
- [x] 新增 runtime 测试：截断 run、pointer 唯一恢复、session corrupt、route 不 fallback、replace 失败保留旧文件。
- [x] 新增 progress 测试：健康与损坏混合、仅损坏、task.json 不可读。
- [x] 新增 JSONL 跨仓兼容测试，确认 `../ai-fund/...` 与绝对路径继续有效。
- [x] 增加正常 create -> active -> auto-loop start_task -> record/next 回归，证明 F6 不改变健康链路。

## 4. Patch Engine 与快照验证

- [x] 运行 JS Patch Engine、platform patch、apply-enhancements、patch-conflicts 测试。
- [x] 运行 Python `test_skill_garden_patches.py`，验证真实 catalog preflight 和 JS/Python consumer 一致。
- [x] 运行 `node scripts/check-patch-conflicts.mjs` 和 strict AI context budget。
- [x] 运行 `npm run sync`，检查 vendor 与 `enhancements/0.6` 的 overrides、scripts、skills 一致。
- [x] 检查 `enhancements/MANIFEST.json` 的 patchFiles、bundles 和 scripts。
- [x] vendor 提交并更新 submodule pin 后，最终 `npm run sync` 刷新 `sourceCommit`。

## 5. Dogfood 应用与幂等

- [x] 通过 Flower enhance-only 正式入口把新快照应用到当前项目，不手改 `.trellis`、`.agents`、`.claude` 最终副本。
- [x] 第一次应用后核对 `.trellis/.flower-manifest.json` provenance 包含新增 operations。
- [x] 记录目标文件 hash，再执行第二次 enhance-only；断言 Patch 修改数为 0 且目标 hash 不变。
- [x] 比较 vendor、enhancements 和当前 dogfood 的 Skill-Garden 自有资产逐字节一致。

## 6. 最终质量门禁

- [x] 运行定向 Python 测试与完整 `npm test`。
- [x] 运行 `npm run sync` 后的 snapshot consistency 检查。
- [x] 运行 `git diff --check`，检查无 runtime 文件、临时文件或计划外 dogfood 手改进入 diff。
- [x] 对照 PRD AC1-AC11 做最终映射，未纳入 F5/F8/F10/F11/F12 不得出现行为漂移。

## 风险与恢复点

- Patch preflight 任一 required selector/baseline 漂移时停止，不修改 dogfood。
- vendor 和 parent repo 分属两个 Git 仓；提交/推送必须按依赖顺序处理，先 Skill-Garden 源，再 sync 后的 Flower 快照与测试。
- enhance-only 会刷新 manifest；只有实际 Patch/资产结果正确后才保留该元数据变化。
