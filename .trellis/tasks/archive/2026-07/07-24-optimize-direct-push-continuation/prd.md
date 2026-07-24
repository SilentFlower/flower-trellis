# 优化 Direct Push 检查后自动续行

## Goal

当用户已经明确请求普通 Push 或用户主动 `commit-only`、但当前 diff 尚无有效 Check-All 结论时，仍先执行 Check-All；若检查无问题，则把原始 Git 请求视为“检查通过后继续”的条件授权，在同一轮自动执行 Update-Spec 并展示唯一 Git 确认计划，避免再次要求用户回复“继续”。

## Background

- 当前普通 Push 必须先具备有效 Check-All 结论及其后的 `spec_update_result=no-op|written`。
- 当前 `Interactive Post-Check Stop Gate` 对所有非 auto-loop Check-All 一律报告后停止，因此用户先说“push”时仍需在检查通过后再说一次“继续”。
- 7 月 23 日的 direct push 设计要求顺序为 `Check-All -> Update-Spec -> Git safety`，但现有 `trellis-push` Step 0 将缺少 Check-All 与缺少 Update-Spec 结果合并描述，边界不够清楚。
- 普通 Push 的 Git 写入仍必须经过 `trellis-push` 展示精确计划并获得一次明确确认；本次条件授权不等于 Git 预授权。

## Requirements

### R1. Direct Git 条件续行

- 用户在 Check-All 开始前已明确请求普通 Push 或用户主动 `commit-only` 时，记录该请求只作为当前 diff 的条件续行意图。
- Check-All 有问题或阻塞时保持现状：报告问题并停止，不执行 Update-Spec，不生成 Push 计划。
- Check-All 整体结论为通过、问题数为 0，且不存在阻塞、部分验证或需要用户接受的实质剩余风险时，不再要求用户回复“继续”；先展示检查结果，再在同一轮进入 `trellis-update-spec`。
- Update-Spec 返回 `no-op` / `written` 时，同一轮加载 `trellis-push` 并展示唯一 Git 确认计划；返回 `needs-review` 时停止。

### R2. 既有检查复用

- 当前 diff 已有有效 Check-All 结论时不得重复检查。
- Check-All 后实际 diff、检查结论适用范围或用户 spec 意图变化时，旧条件续行失效并重新经过对应 Gate。

### R3. 安全边界

- 条件续行不得跳过 Check-All、Update-Spec 或 Push exact-path/Git 安全检查。
- 条件续行不得自动确认 commit message、文件范围、目标分支或远端 Push；最终 Push 计划仍只确认一次。
- Check-All 有发现时，原始 Push 请求不得被解释为“自动修复全部”或“忽略问题继续提交”。
- 条件续行不得隐藏或改写 Check-All 结果；继续使用现有标准报告，用户必须在最终 Git 计划确认前看到本轮检查结论、验证和剩余风险。
- auto-loop 的 `record + next` 与内部 `commit-only` 预授权保持不变；不得把内部 `commit-only` 当作本次 direct Git 条件续行。

### R4. Owner 与分发

- 完整条件续行语义收敛到现有 Check-All / Phase 2.2 的 `Interactive Post-Check Stop Gate` owner；不新增独立 Gate，workflow hub 与 state 只保留 owner 指针和一跳顺序。
- `trellis-push` Step 0 明确区分“缺少或过期 Check-All”与“Check-All 有效但缺少或过期 spec_update_result”。
- 修改从 `vendor/skill-garden/.trellis/0.6` 权威源开始，再同步 `enhancements/0.6`、当前 dogfood 和 compiled targets。
- agents / claude 与各平台 Patch 入口保持一致。

## Acceptance Criteria

- [ ] AC1：用户先说 Push 或用户主动 `commit-only`，Check-All 严格通过时先展示检查结果，再在同一轮完成 Update-Spec 并展示唯一 Git 计划，不再出现额外“继续”提示。
- [ ] AC2：用户先说 Push 或用户主动 `commit-only`，Check-All 有问题或阻塞时停止且不展示 Git 计划。
- [ ] AC3：已有有效 Check-All 和 spec_update_result 时直接进入 Git 计划，不重复检查或更新规范。
- [ ] AC4：已有有效 Check-All、但缺少或过期 spec_update_result 时只补跑 Update-Spec，不重复 Check-All。
- [ ] AC5：缺少或过期 Check-All 时先进入 Check-All，不得直接进入 Update-Spec 或读取 Git 提交计划。
- [ ] AC6：最终 commit/push 仍等待一次明确计划确认；条件续行不扩大 Git 授权。
- [ ] AC7：interactive 普通“检查一下”仍保持报告后停止；只有检查前已存在匹配的 direct Push 或用户主动 `commit-only` 意图时使用条件续行。
- [ ] AC8：auto-loop、问题修复/重检、用户 `commit-only`、内部 `commit-only` 和普通 next/continue 流程无回归。
- [ ] AC9：源、快照、dogfood 与 compiled targets 一致，Patch conflict 和上下文预算通过。

## Out of Scope

- 不增加新的持久化 Check-All 结果数据库、通用 Gate Engine 或独立流程控制器。
- 不修改依赖型多仓生成命令识别规则。
- 不减少 Push exact files、branch/upstream、ahead、冲突和 staged 安全检查。
