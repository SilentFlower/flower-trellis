# Untracked 流程游标与 Push 路由实施计划

## 1. 收缩 Untracked Helper

- [x] 把 vendor `untracked_flow.py` 状态收缩为 v2 的 id、summary、source、stage 和时间戳。
- [x] `begin` 直接进入 `implement`；`advance` 支持 `implement|check|spec|push`，只更新游标且允许返工回退。
- [x] 删除 `prepare-edit`、`record-validation`、`record-check`、`record-spec` 及 baseline/scope/fingerprint/evidence 校验。
- [x] 保留 active-work conflict、损坏 runtime、work-id clear 校验和稳定 JSON 输出。
- [x] 增加 v1 兼容读取与惰性迁移测试，确认旧 `inspect` 映射为 `implement`。

## 2. 简化 Owner 契约与 Task Adoption

- [x] 修改 no-task、Phase 2 implement/check、Phase 3 Update-Spec/Push owner 文案，只在 owner 切换时更新游标。
- [x] 更新 `.agents` / `.claude` Check-All、Update-Spec、Trellis Push 副本，移除旧证据命令和 workspace fingerprint 前置条件。
- [x] 修改 `task_intent.py adopt`：不验证 untracked workspace，不读取旧证据；在 adoption 当下为 task 捕获新的 baseline。
- [x] 补 task adoption 测试，覆盖 v1/v2 状态和工作区已变化场景。

## 3. 增加阶段专用面包屑

- [x] 将通用 `workflow-state:untracked` 拆成 implement/check/spec/push 的一跳路由，或用等价的 stage-aware resolver 实现相同效果。
- [x] 修改共享 per-turn hook 和 breadcrumb 配置，根据 untracked stage 选择对应 key。
- [x] 确保 `stage=push` 的提示明确加载 `trellis-push`，且不把游标当成已执行或已确认的 Push。
- [x] 补 hook、workflow gate、Patch conflict 和 context budget 测试。

## 4. 同步 Authoring、Snapshot 与 Dogfood

- [x] 在 `vendor/skill-garden/.trellis/0.6/` 完成产品源修改与定向测试。
- [x] 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的 Stable Untracked Completion Chain 场景。
- [x] 在根项目运行 `npm run sync` 生成 `enhancements/0.6`。
- [x] 通过既有 Flower Plugin/dogfood 路径刷新 `.trellis/`、`.agents/`、`.claude/`、`.codex/`；不手工维护平行实现。
- [x] 验证 0.5 和 old 无变化。

## 5. Validation Commands

```bash
python3 -m unittest \
  test.python.test_untracked_flow \
  test.python.test_task_intent \
  test.python.test_workflow_state_hook

node --test \
  test/js/untracked-flow-gate.test.js \
  test/js/workflow-gate-ownership.test.js \
  test/js/apply-enhancements.test.js

npm run sync
node scripts/check-snapshot.mjs
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs --strict
npm test

python3 -m py_compile \
  vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py \
  vendor/skill-garden/.trellis/0.6/scripts/task_intent.py

git -C vendor/skill-garden diff --check
git diff --check
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-03-fix-untracked-spec-push-gate
```

## 6. Review Gates

- [x] Untracked helper 不再读取 Git evidence，也不以 workspace drift 阻止任何阶段推进。
- [x] 四个阶段各自只路由到一个 owner；push 面包屑明确进入 `trellis-push`。
- [x] Check-All、Update-Spec 和 Push 的真实质量/安全规则仍由各自 owner 持有。
- [x] Task adoption 在当前时点捕获 task baseline，不复用 untracked 的旧 fingerprint。
- [x] vendor、snapshot、dogfood 与平台目标一致，0.5/old 无变化。

## 7. Rollback Points

- Helper：恢复 `untracked_flow.py` 与 `task_intent.py` 后重跑 Python 测试。
- Workflow：恢复 stage-aware breadcrumb 和 owner Patch 后重跑 hook/JS 测试。
- 同步后：只从恢复后的 vendor source 重新执行 sync 与 dogfood，不单独修改生成结果。
