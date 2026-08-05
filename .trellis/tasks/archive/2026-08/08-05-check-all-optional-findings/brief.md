# Brief — 区分 Check-All 必修问题与可选改进

## Goal

- 让 Check-All 将真实错误、契约违背和发布风险与纯防御性兜底建议分开呈现，避免非逻辑错误阻断验收和交付。

## Scope

- 新增独立 `OPT-*` 可选改进通道，保留 `CHK-*` 必修问题和 `DOC-*` 文档自动修复通道。
- 为 `OPT-*` 定义严格、fail-closed 的准入条件和禁止降级清单。
- 更新统一报告、修复授权、strict pass、untracked、auto-loop、direct Git 和 push 处置语义。
- 同步更新 inline/subagent、route dispatch、workflow Phase 2.2、light/full profile 和双平台源副本。
- 更新 Skill-Garden 0.6 派生快照、compiled targets、当前 dogfood 副本和聚焦契约测试。

## Non-Goals

- 不把任何 P 级别直接绑定为必修或可选，不弱化失败测试、需求/spec 违背、安全、数据、兼容和发布问题。
- 不自动修复 `OPT-*`，也不让 `修复全部` 隐式包含可选项。
- 不修改 Check-All 深度路由、三维检查模型、`DOC-*` 白名单、route 模式选择、0.5/old 变体或 npm 上游基础 `trellis-check`。
- 不新增持久化 findings 文件或跨会话 `OPT-*` 编号。

## Key Decisions

- 使用独立 `OPT-*`；先判定 `CHK-*` / `OPT-*`，再只对 `CHK-*` 分配 P0/P1/P2，严重度不能反向决定处置。
- 历史 P1 如果只是对极端场景假设后果的评级、没有现实错误证据且满足全部准入条件，可以重新分类为 `OPT-*`；P2 也不能自动视为可选。
- 只有当前契约已满足、验证无失败、无真实可达错误且不影响当前验收时，发现才能标为 `OPT-*`；证据不足时保留为 `CHK-*`、部分验证或剩余风险。
- `OPT-*` 不使用 P0/P1/P2，报告必须展示“为什么可选”和具体 defense-in-depth 收益。
- optional-only 报告按严格通过处理，不返回 implement，不阻断 auto-loop `ok`、direct Git、Update-Spec 或 Push。
- `修复全部` 只修复 `CHK-*`；`OPT-*` 需要精确 ID 或明确的全部可选项授权。

## Key Context

- 当前规则把所有普通发现先放入 `CHK-*`，再按假设影响分级；这会让部分纯兜底被误判为 P1，并让任意 `CHK-*` 都进入修复循环、阻断 strict pass。
- 持久化源位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/`、compiled targets 和项目 dogfood 文件均为派生产物。
- 关键 owner 包括 `trellis-check-all`、`trellis-route`、workflow Phase 2.2 和 `trellis-push`，必须同步语义，不能只改报告文案。
- 任务上下文与现状依据记录在 `.trellis/tasks/08-05-check-all-optional-findings/research/current-check-all-rules.md`。

## Risks / Deferred

- 最大风险是把真实问题错误降级为 `OPT-*`；通过四项准入条件、禁止降级清单和 fail-closed 测试约束。
- workflow 和 push 当前使用泛化的 `findings` 措辞，必须显式收紧为阻断性 `CHK-*`，否则 optional-only 仍可能被间接阻断。
- 双仓生成顺序保持现有约束：vendor 源和 compiled targets 先更新，父仓快照随后 sync；最终 `sourceCommit` 校验留在既有 Phase 3.4。

## Acceptance

- `CHK-*`、`OPT-*`、`DOC-*` 在报告中独立统计和展示，P1/P2 都不会直接决定必修或可选。
- 只有假设后果、没有现实错误证据的历史 P1 兜底，满足全部准入条件时会改列为 `OPT-*`。
- 失败验证、契约违背、必需测试缺失、兼容、安全、数据和发布问题不能标为可选。
- 只有 `OPT-*` 时 Check-All、auto-loop、untracked、direct Git 和 push 都按通过路径处理。
- inline/subagent、route、workflow、profiles 和 push 语义一致，0.6 源、快照、compiled targets 与 dogfood 副本同步。
- 聚焦测试、`npm run patch:targets:check`、`npm test`、父仓和 vendor 的 `git diff --check` 全部通过。

## Next Step

- 实现与最终 Check-All 已完成；等待用户回复 `继续`，进入 `trellis-update-spec`，再由 `trellis-push` 生成双仓提交计划。
