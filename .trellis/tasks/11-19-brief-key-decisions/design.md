# Brief 关键取舍与规划边界设计

## Ownership And Entry Points

- `.flower/state.json` 将两端 `trellis-task-brief/SKILL.md` 登记为 Skill-Garden 独占内容，将 Brainstorm handoff/summary-shape 登记为受管 Patch。
- Brief 作者源为 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-task-brief/SKILL.md` 与 `.claude/skills/trellis-task-brief/SKILL.md`，保持内容一致。
- 规划规则归 `overrides/patches/skills/trellis-brainstorm/planning-handoff/content.md` 与 `summary-shape-content.md` 所有。修改英文目标载荷时沿用英文。
- `review_planning_readiness` 已引用 Brainstorm Quality Bar，因此复用该 owner 的新增规则；不建立第二份 readiness 规则或新的 runtime 字段。

## Brief Extraction And Presentation

保持原章节顺序和可选章节语义。把关键限制和决定优先写入 `Context & Decisions`，具体交付风险写入 `Risks`；Non-Goals 中影响目标的排除项同样需要明确影响。

每条用简短的“具体限制或决定 + 用户影响”表达。默认使用 `**【重要限制】……**` 等 Markdown 表达，关键结果完整加粗。普通上下文与技术概览保持常规字重；通常突出 3～5 处，依据实际重要信息调整。纯 Markdown 为默认路径，颜色只作辅助。

原材料是事实与决定的权威来源。若摘要审查发现未表达的重大限制或未决取舍，先更新相关材料并按现有规划/增量规则收敛。待决定项保留其状态，不能因标亮或展示而视为批准。

## Planning Boundary Review

在 Brainstorm Quality Bar 加入语义审查：

1. 按用户最终完成操作的路径识别相关入口和必要的恢复、升级衔接。
2. 检查新增及沿用的阻断条件，区分业务要求、技术事实、资源条件和实现取舍，核对依据与必要性。
3. 分析排除项和人工回退对目标的影响；尚未明确的产品取舍进入现有 Open Questions/确认流程。
4. 验收覆盖完整结果及关键失败后的恢复，防止局部通过留下相互等待或另一入口继续受阻。

本规则要求针对当前目标的必要关联分析。独立业务扩展继续服从现有范围管理。数据完整性、身份及授权等既有保护按适用合同处理。

## Distribution And Validation

从作者源经 `npm run sync` 刷新 `enhancements/0.6`，经 `npm run patch:targets` 更新全平台 canonical targets，最后通过 Flower Plugin 生命周期刷新当前项目投影。

复用 `test/js/brief-preauthorization.test.js`、现有 Patch 门禁与规则专项。必要断言围绕章节职责、软展示建议、限制审查及未决决定状态；用当前任务的派生 Brief 实例人工核对摘要效果。

## Risks And Rollback

- 提示词变长可能触发上下文预算；优先在原 owner 的现有段落集中表达，strict budget 按实际结果验证。
- 仅验证文本和投影只能说明规则已交付，真实后续任务的行为效果需另行观察。
- 受管投影依赖完整源链同步。回滚按本次精确作者源、快照、compiled targets 与投影变更集合恢复。
