# Brief — 优化 Direct Push 检查后自动续行

## Goal

- 用户已明确请求普通 Push 或用户主动 `commit-only` 时，仍先完成 Check-All；严格通过后沿用现有标准检查报告，并在同一轮自动进入 Update-Spec 和唯一 Git 确认计划，省去额外“继续”回合。

## Scope

- 在现有 `Interactive Post-Check Stop Gate` owner 内增加 direct Git strict-pass 窄分支，不新增 Gate。
- Check-All 整体通过、0 问题、无阻塞、无部分验证、无待用户接受的实质风险时，同轮进入 Update-Spec。
- Update-Spec 的 direct Git 入口覆盖普通 Push 与用户主动 `commit-only`；`no-op|written` 后加载 Trellis Push，`needs-review` 停止。
- Trellis Push Step 0 区分缺少/过期 Check-All 与仅缺少/过期 `spec_update_result`，复用有效结论。
- 更新 Phase 2.2、in-progress state、双平台 Check-All/Push、Update-Spec override、code-spec 和回归测试。
- 从 vendor 权威源同步 enhancements、当前 dogfood 和 compiled targets。

## Non-Goals

- 不修改依赖型多仓 `npm run sync` 识别规则。
- 不新增持久化 Check-All 状态、runtime schema、helper、Gate Engine 或第二套检查摘要模板。
- 不改变普通“检查一下”的报告后停止行为。
- 不改变 auto-loop `record + next` 与内部 `commit-only` 预授权。
- 不减少 Push exact files、commit message、branch/upstream、ahead、冲突、staged 和最终确认检查。

## Key Context

- direct Git intent 只来自触发本轮完成链的最新用户消息，不从历史、摘要、dirty 状态或 auto-loop 推断。
- 用户原始 Git 请求只授权“检查严格通过后继续到计划”，不授权 commit 或 push；最终计划仍需一次明确确认。
- Check-All 有 findings、blocked、部分验证或实质剩余风险时，继续输出标准报告并停止，不运行 Update-Spec 或生成 Git 计划。
- strict pass 仍展示现有标准 Check-All 报告；Check-All 不生成 Git 计划，后续计划由 Update-Spec disposition 和 Trellis Push owner 负责。
- Hub 只保留 owner 索引与跨阶段顺序；完整条件矩阵留在 Phase 2.2 / Check-All，state 只保留一跳提示。
- 主要风险是 direct Git 识别过宽、Stop Gate 双 owner、Check-All/spec 缺失分支混淆和 subagent 返回后错误停止；均需行为测试覆盖。

## Acceptance

- direct Push 或用户主动 `commit-only` 在缺少当前 Check-All 时先检查；strict pass 后同轮展示检查报告、执行 Update-Spec 并展示唯一 Git 计划。
- findings、blocked、部分验证或实质剩余风险时停止且不展示 Git 计划。
- 有效 Check-All/spec 结果按层复用：两者有效直接计划，仅 spec 缺失只补 Update-Spec，Check-All 缺失先检查。
- 普通 interactive check、普通 next/continue、问题修复/重检、inline/subagent、auto-loop 和内部 commit-only 无回归。
- 最终 Git 动作仍等待 Trellis Push 精确计划确认。
- vendor、snapshot、dogfood、compiled targets 一致，定向测试、完整测试、Patch conflict、strict context budget 和 diff check 通过。

## Next Step

- 规划确认后运行 `task.py start`，进入 `trellis-route(target=implement)`；按 vendor 权威源 -> 测试/spec -> sync/dogfood/compiled targets -> 完整 Check-All 的顺序实施。
