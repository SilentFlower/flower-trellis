# 区分 Check-All 必修问题与可选改进

## Goal

让 Check-All 把真实错误、契约违背和发布风险与纯防御性兜底建议分开呈现：前者继续作为必须处理的 `CHK-*`，后者明确标记为不阻断验收和交付的可选改进，减少用户被非逻辑错误反复打断的情况。

## Background

- 当前所有普通发现都先进入 `CHK-*`，再按假设影响分为 `P0/P1/P2`。这会让没有现实错误证据的极端场景兜底也可能被打成 P1；同时 P2 又覆盖测试、规范、维护性和非阻塞风险。因此任何现有严重度都不能直接决定“必修或可选”：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/reporting-and-disposition.md:13`。
- 当前只要存在任意 `CHK-*`，报告就要求选择修复范围，严格通过、auto-loop `ok` 和 direct Git 继续条件也都要求剩余 `CHK-*` 为 0：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/references/reporting-and-disposition.md:84`、`:137`、`:152`。
- 当前 route agent、workflow Phase 2.2 和 push 完成链都使用“全部 findings 都阻断”的语义，不能只改报告文案：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/references/check-all-agent-body.md:8`、`vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/phase-ownership/phase-2-check-content.md:9`、`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md:36`。
- 0.6 的持久化源位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/`、compiled targets 和当前 dogfood 副本都是派生产物，必须从源同步。

## Requirements

### R1. 新增独立可选改进模型

- 新增稳定 ID 通道 `OPT-001`、`OPT-002`，与 `CHK-*`、`DOC-*` 分开编号。
- `CHK-*` 继续表示必须处理的问题；`OPT-*` 只表示当前契约已满足后的防御性增强、额外容错或非必要兜底。
- 分类顺序固定为“先判定 `CHK-*` 或 `OPT-*`，再只对 `CHK-*` 分配 P0/P1/P2”；不得先按假设影响打 P1/P2，再把严重度当作必修依据。
- 历史或候选发现即使最初标为 P1，只要没有现实错误证据且满足全部可选准入条件，也应重新分类为 `OPT-*`；反之，P2 也不能自动降级为可选。
- 每个 `OPT-*` 至少包含标题、来源、证据、为什么可选、收益、位置和验证方式。

### R2. 可选分类必须满足严格条件

一个发现只有同时满足以下条件时才能进入 `OPT-*`：

1. 当前 PRD、设计、实现计划、项目 spec、公开契约和已声明支持范围均已满足；
2. 没有失败的测试、lint、typecheck 或其它验证证据；
3. 没有可复现或有证据可达的功能错误、安全风险、数据风险、兼容性错误或发布阻塞；
4. 不修复不会改变当前验收结论，只会放弃额外的 defense-in-depth 收益。

这里判断的是当前事实和已声明边界，不是假设“如果极端场景发生，后果可能很严重”的影响推演。只有假设后果、没有当前可达性或契约证据的兜底候选，可以在满足上述条件后进入 `OPT-*`。

以下发现不得标为可选：需求或 spec 违背、失败验证、缺失的必需测试、已声明支持环境中的兼容问题、真实可达边界错误、安全或数据风险、发布门禁失败、无法证明无影响的未知风险。

证据不足时必须保守保留为 `CHK-*`、部分验证或剩余风险，不得为了减少问题数降级。

### R3. 报告清晰区分必修与可选

- 总览分别统计 `CHK <N>`、`OPT <N>` 和自动修复 `DOC <N>`。
- `CHK-*` 保留“问题清单”和修复批次；`OPT-*` 使用独立“可选改进”区，并明确“不影响当前通过/发布结论”。
- 每个 `OPT-*` 必须展示“为什么可选”，让用户能判断它不是被弱化的真实错误。
- `修复全部` 只表示修复全部 `CHK-*`，不隐式包含 `OPT-*`；可选项只能通过精确 `OPT-*` ID 或明确“修复全部可选项”授权。
- 只有 `OPT-*` 时，报告总体状态仍为通过，下一步主动作仍是继续完成链；可选修复提示作为非阻断说明展示。

### R4. 统一处置和状态语义

- strict pass 的阻断条件继续是剩余 `CHK-*`、阻塞、部分验证或待用户接受的实质风险；存在合规 `OPT-*` 本身不阻断。
- untracked 流程只有 `CHK-*`、阻塞、部分验证或新编辑才回到 `implement`；仅有 `OPT-*` 时按通过路径处理。
- validated auto-loop 只有 `OPT-*` 时记录 `ok`，摘要包含可选项数量和 ID，不消耗 fix/recheck 预算。
- direct Git 严格通过时允许存在 `OPT-*`，继续进入 Update-Spec 和 Push。
- `trellis-push` 必须把只有 `OPT-*` 的有效 Check-All 报告识别为“通过”，不能误标为“存在 findings”风险。

### R5. Inline、subagent 与平台语义一致

- `trellis-check-all` 入口、light/full profile、报告与处置引用都使用一致的 `CHK-*` / `OPT-*` / `DOC-*` 模型。
- 专用 check-all subagent 和 `trellis-route` dispatch prompt 必须返回全部三类结果；subagent 仍保持 audit-only，不代替用户选择可选修复范围。
- workflow Phase 2.2 只把阻断性 `CHK-*` 作为 repair loop findings；`OPT-*` 为报告型、非阻断项。
- `.agents` 与 `.claude` 源副本保持语义和内容一致，派生快照与 dogfood 副本同步更新。

### R6. 测试和交付范围

- 增加静态契约测试，覆盖可选项分类边界、报告字段、strict pass、auto-loop、route agent、workflow 和 push 语义。
- 修改 0.6 源后运行 `npm run sync` 和 `npm run patch:targets`，再执行对应零漂移检查。
- 不修改 0.5、old 变体，不引入新的运行时状态文件，不改变 Check-All 的三维检查模型和 light/full 路由规则。

## Acceptance Criteria

- [ ] AC1：Check-All 先判定 `CHK-*` / `OPT-*`，再只对 `CHK-*` 分配 P0/P1/P2；现有 P1/P2 标签都不能直接决定处置。
- [ ] AC2：只有满足“契约已满足、验证无失败、无真实可达错误、不影响当前验收”四项条件的发现才能进入 `OPT-*`。
- [ ] AC3：纯假设后果导致的历史 P1 兜底在满足全部准入条件时可重新分类为 `OPT-*`；失败测试、需求/spec 违背、必需测试缺失、声明支持范围内兼容问题、安全/数据风险和发布阻塞始终保留为 `CHK-*` 或更严格状态。
- [ ] AC4：统一报告分别统计和展示 `CHK-*`、`OPT-*`、`DOC-*`，每个 `OPT-*` 都说明“为什么可选”。
- [ ] AC5：`修复全部` 只覆盖 `CHK-*`；修复 `OPT-*` 需要精确 ID 或明确的全部可选项授权。
- [ ] AC6：只有 `OPT-*` 时 Check-All 结论为通过，不返回 implement，不阻断普通继续、direct Git、Update-Spec 或 Push。
- [ ] AC7：validated auto-loop 在只有 `OPT-*` 时记录 `ok`，摘要保留可选项，但不进入 fix/recheck。
- [ ] AC8：inline、subagent、route dispatch、workflow Phase 2.2、light/full profile 和 push 完成链对可选项使用一致语义。
- [ ] AC9：0.6 `.agents` / `.claude` 源、`enhancements/0.6`、compiled targets 和当前 dogfood 副本按项目同步规则保持一致。
- [ ] AC10：新增聚焦测试、`npm run patch:targets:check`、`npm test` 和 `git diff --check` 通过；双仓发布快照检查按既有交付顺序执行。

## Out of Scope

- 自动修复 `OPT-*` 或在用户未授权时把它们加入 `修复全部`。
- 按主观偏好把代码风格建议、重构想法或所有“更健壮”建议都输出为 `OPT-*`；缺少具体证据和可验证收益的想法不进入报告。
- 修改 Check-All 深度选择、三维检查顺序、`DOC-*` 自动修复白名单或 route 模式选择机制。
- 修改 Trellis 0.5、old 变体或 npm 上游基础 `trellis-check`。
- 新增持久化 findings 文件或跨会话保存 `OPT-*` 编号。
