# 当前 Check-All 问题展示与处置规则

## 已确认行为

- 所有普通实现偏差、验证失败和假设错误都统一进入 `CHK-*`；低风险任务文档漂移进入 `DOC-*`。
- `CHK-*` 严重度为 `P0/P1/P2`。当前模型会先把发现当成问题，再根据假设影响打级别，所以纯极端场景兜底也可能被判成 P1；P2 又包含测试、规范、维护性和非阻塞风险。严重度高低都不等于必修/可选分类。
- 报告只展示 `CHK-*` 问题清单，存在任意 `CHK-*` 时提供一次 `修复全部`、按 ID 修复或仅保留报告的选择。
- strict pass、auto-loop `ok`、direct Git 同轮继续和 untracked 通过路径都要求没有剩余 `CHK-*`，并且无阻塞、部分验证或实质剩余风险。
- route 专用 agent、workflow Phase 2.2 和 push 完成链沿用同一“findings 即阻断”语义。

## 根因

现有模型只有“阻断性问题”和“自动修复文档漂移”两个通道，缺少“当前行为正确，但存在额外 defense-in-depth 收益”的非阻断通道。若只在标题上写“可选”，后续状态机仍会把它当成 `CHK-*` 阻断，所以必须同步修改问题模型和处置契约。

## 设计约束

- 不把 P2 整体改成可选，否则失败测试、必需规范和兼容性问题会被错误弱化。
- 也不保留“P1 天然必修”的前提；如果旧 P1 只有假设后果、没有当前错误或可达性证据，并满足可选准入条件，应重新归类为 `OPT-*`。
- 正确顺序是先依据当前契约、可达性和验证证据判定 `CHK-*` / `OPT-*`，再只为 `CHK-*` 分配 P0/P1/P2。
- 可选分类必须有正向证据证明当前契约和验收已满足；证据不足时 fail-closed。
- 新通道不能改变 `DOC-*` 白名单或获得自动写入权限。
- optional-only 报告要继续完成链，否则“可选修复”只是展示文案，没有实际处置价值。

## 持久化与同步约束

- Skill-Garden 0.6 的真实源是 `vendor/skill-garden/.trellis/0.6/`，不能直接把 `enhancements/0.6/` 或当前 `.agents` / `.claude` dogfood 副本当作作者源。
- `.agents` 与 `.claude` 的同名 skill 源必须保持语义一致；共享 agent body 位于 `.agents/skills/trellis-route/references/`，不要臆造 `.claude` references 目录。
- workflow Phase 2.2 是受管 Patch 内容，修改 `overrides/patches/workflow/phase-ownership/phase-2-check-content.md` 后需要重新生成 compiled targets。
- 正确顺序是修改 vendor 源、运行 `npm run patch:targets`、运行 `npm run sync`，再通过既有 Flower dogfood 同步链更新当前项目产物。
- `enhancements/0.6/` 由 sync 全量重建，compiled targets 是可审阅 canonical 产物；两者都应通过零漂移检查，不能手工形成独立语义。
- 双仓 dirty 必须分别检查；vendor 子仓产生新提交后，父仓 manifest 的 `sourceCommit` 需要重新 sync，最终快照检查留在既有 Phase 3.4 交付顺序中。

## 历史依据

- 归档任务 `.trellis/tasks/archive/2026-07/07-14-check-all-collect-report/` 建立了稳定 `CHK-*` ID、P0/P1/P2、单次修复确认和 strict pass 规则。
- 本次改动在该模型上新增非阻断通道，不回退 collect-all、audit-only 或报告固定顺序。
