# Implement — 优化实现后检查卡点与暂缓状态

## 1. Runtime Helper

- [x] 在 vendor 0.6 scripts 新增 `pre_check_state.py`，实现 `status/hold/clear`、紧凑 JSON、`--verbose`、当前任务/context key 校验和原子写入。
- [x] 提供供 hook 调用的只读函数；缺失、损坏、I/O 错误和 task mismatch 使用稳定结构化结果。
- [x] 为 helper 添加 Python 单测：runtime missing、hold/status、clear、任务隔离、损坏与 I/O 保护、写入失败、同 session resume、不同 context key 不继承。

## 2. Workflow Contract

- [x] 更新 workflow hub Patch：增加简短 Pre-Check 边界，并明确 validated auto-loop 优先。
- [x] 更新 Phase 2.1 Patch：首次实现自动进入检查；显式暂缓和首条追加修改写入 hold；每次暂缓交付输出短引导。
- [x] 更新 Phase 2.2 Patch：进入 Check-All 前清除匹配 hold；保留现有 audit-only Post-Check Stop Gate。
- [x] 评估 in-progress state 后不增加重复提示，完整规则保留在 Phase 2.1 以控制高频上下文。

## 3. SessionStart Recovery

- [x] 为 Codex 和 Claude SessionStart 增加 Patch，在 compact current-state 构建时条件读取当前 session hold。
- [x] 无 hold 时不增加动态行；有 hold 时只增加一条可覆盖提示；helper 读取失败时静默退化。
- [x] 增加 hook 测试：默认无增量、匹配 hold 注入、task mismatch 不注入、不同 context key 不注入、压缩/resume 相同 context key 可恢复。

## 4. Auto-Loop

- [x] 更新 `.agents` / `.claude` 的 `trellis-auto-loop` 源副本：启动/恢复时静默清除 hold，validated runner 不读取交互偏好。
- [x] 保持 `auto_loop.py` action、检查深度、三轮预算和 commit-only 代码不变。
- [x] 增加静态/行为测试，确认陈旧 hold 不改变 `run_implement -> run_check_all` 和 `run_fix -> run_recheck`。

## 5. Distribution

- [x] 更新 `src/lib/copy-scripts.js` 的 helper 精细安装别名及相应安装测试。
- [x] 在 vendor 源完成修改后运行 `npm run sync`，生成 `enhancements/0.6` 快照。
- [x] 应用增强到 dogfood 项目，确认 `.agents`、`.claude`、`.trellis/scripts`、hooks 和 workflow 最终产物一致。
- [x] 更新 `enhancements-model.md` 的可执行契约与 Good/Base/Bad 场景。

## 6. Validation

- [x] 运行 helper Python 单测、SessionStart/workflow-state hook 单测和相关 JS Patch/安装测试。
- [x] 运行 `npm test`。
- [x] 运行 `node scripts/check-ai-context-budget.mjs`。
- [x] 运行 `node scripts/check-ai-context-budget.mjs --strict`。
- [x] 运行新增/修改 Python 与 JS 语法检查。
- [x] 运行 `git diff --check`，并核对 submodule、snapshot 和 dogfood diff 范围。

## 7. Rollback Points

- [x] helper 写入前保留现有 session runtime 字段，禁止覆盖 route/current task/auto-loop 状态。
- [x] SessionStart Patch 可独立回滚，helper 缺失时 hook 静默退化为 workflow 默认检查行为。
- [x] 上下文预算曾超过 review ceiling，已删除重复 hub/state 文案并保持原阈值。
