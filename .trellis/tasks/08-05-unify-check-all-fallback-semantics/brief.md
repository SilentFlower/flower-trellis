# Brief — 统一 Check-All 兜底分类语义

## Goal

- 将 Check-All 从 `CHK-*` / `OPT-*` / `DOC-*` 模型收敛为 `CHK-*` / `FBK-*` / `DOC-*`：兜底问题按根因性质统一进入正式 `FBK-*` 通道，不再展示或执行“可选/不可选”判断。

## Scope

- 在 skill-garden 0.6 的 Check-All 中建立 `FBK-*` 编号、准入、严重度、报告和修复契约。
- 将 `optional-findings.md` 替换为 `fallback-findings.md`，删除 `OPT-*`、可选改进和单独授权分支。
- 让 `修复全部` 同时覆盖 `CHK-*` 与 `FBK-*`，精确修复支持混合 ID。
- 同步更新 light/full profile、DOC 转换、route、专用 check-all agent、workflow Phase 2.2、auto-loop、untracked、direct Git 和 push 判定。
- 更新 Flower 规范、聚焦测试、`enhancements/0.6` 快照、当前 dogfood 投影和需要刷新的 compiled targets。

## Non-Goals

- 不修改 Check-All 的 light/full 深度选择、三维检查顺序或 audit-only 边界。
- 不修改 `DOC-*` 自动修复白名单、route 模式选择、auto-loop 预算或 Git 确认门禁。
- 不新增 findings 持久化文件，不迁移历史 `OPT-*` ID，不回写归档任务材料。
- 不修改 skill-garden 0.5、old 或无关平台行为。

## Key Decisions

- `FBK-*` 表达问题性质，不是可选级别；它和 `CHK-*` 都进入修复循环、阻断 strict pass，并被 `修复全部` 默认覆盖。
- fail-closed、异常输入、失败降级、防御性权限/数据保护和可观测性兜底缺口优先归 `FBK-*`；即使已违反明确兜底契约，也不改列为 `CHK-*`。
- `CHK-*` 与 `FBK-*` 均按当前实际影响分配 P0/P1/P2；严重度不改变通道归属和修复义务。
- `FBK-*` 必须具备具体场景、证据、保护收益和验证方式；纯偏好或泛化“更健壮”建议不报告。
- strict pass 的统一条件是剩余 `CHK-*` 与 `FBK-*` 均为 0；不保留 optional-only 的特殊通过路径。

## Key Context

- 上一版 OPT 模型记录在 `.trellis/tasks/archive/2026-08/08-05-check-all-optional-findings/`，本任务替换其当前运行语义但保留历史文件原文。
- 真实源位于 `vendor/skill-garden/.trellis/0.6`；`npm run sync` 只生成 `enhancements/0.6`，当前项目副本需再走 dogfood update 投影链。
- 受影响 owner 包括 `trellis-check-all`、`trellis-route`、专用 check-all agent、workflow Phase 2.2 Patch、`trellis-push`、auto-loop/untracked 规范和跨平台投影。
- 项目规范要求源、快照、dogfood、Patch catalog 和 compiled targets 保持一致；0.5/old 必须无漂移。

## Risks / Deferred

- 主要风险是把主观防御性建议变成阻断项；通过严格 FBK 准入条件和“不满足则不报告”控制。
- 跨 owner 遗漏会导致 interactive、auto-loop、untracked 或 push 对同一 FBK 得出不同结论，必须用静态契约测试和完整质量门锁定。
- `node scripts/check-snapshot.mjs` 只能在 skill-garden 提交、父仓 pin 更新并重新同步后通过，归属 Phase 3.4。

## Acceptance

- 0.6 源、快照、dogfood 和当前规范中不再存在运行态 `OPT-*`、`optional-findings.md` 或 `修复全部可选项` 语义。
- fail-closed 等兜底缺口稳定生成 `FBK-*`；两类问题均有严重度，`修复全部` 同时处理 CHK/FBK。
- 任一未解决 `FBK-*` 都让 interactive 未通过、auto-loop `failed`、untracked 返回 implement，并阻止 direct Git/Update-Spec/Push strict pass。
- route、agent、workflow、push 与报告使用一致的 `CHK-*` / `FBK-*` / `DOC-*` 模型，且报告只询问一次修复范围。
- 聚焦测试、完整 `npm test`、Patch 冲突、compiled targets、上下文预算、语法、diff 和最终快照一致性检查通过，0.5/old 无漂移。

## Next Step

- full Check-All 重检已通过；下一步进入 `trellis-update-spec`，再由 `trellis-push` 生成提交计划。
