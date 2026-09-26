# Design — 任务 Brief 栏目收敛

## Current Boundary

`trellis-task-brief` 是从最新规划材料派生并展示 `brief.md` 的权威入口。`trellis-brainstorm` 只约束最终交接摘要应覆盖的内容；`task.py start` 检查 brief 是否存在且未过期。栏目改变属于文案与派生视图合同，不需要修改启动脚本或历史任务文件。

## Brief Shape

栏目顺序为 `Goal`、`Scope`、`Non-Goals`、`Technical Overview`、`Context & Decisions`、可选 `Risks`、`Acceptance`、`Next Step`。

- `Goal` 用一句话表达任务目的；`Scope` 只列本轮纳入的行为或改动对象，不写技术原理、取舍理由或验证条件。`Non-Goals` 列明确排除的边界，不引入 `Deliverables` 栏目。
- `Technical Overview` 回答“方案怎样运转”：以简短的入口、处理流、关键校验或状态变化、结果串起原理。仅从 `design.md`、`implement.md` 或已有 `prd.md` 中明确的技术机制提炼；来源没有技术机制时省略，不写猜测或“未明确”。避免复制完整设计与实施步骤。
- `Context & Decisions` 回答“方案依赖什么、为何这样选”：保留必要的现有入口或模块、硬约束，以及会改变实施判断的最终选择及原因。处理流程已在概览说明时不重复描述。
- `Risks` 只记录尚需在实施或验证中关注的风险，整节可省略。已明确延期的工作写入 `Non-Goals`；`Acceptance` 只承载可验证结果，安全或兼容边界需要回归时才保留对应负向断言。
- 其它栏目及 brief 来源、完整展示、评审确认、auto-loop 例外保持现有合同。

## Authoring And Distribution

1. 同步修改 Skill-Garden 0.6 作者源中的 Codex/Claude `trellis-task-brief`，保持两份相同。
2. 修改 `trellis-brainstorm/planning-handoff/summary-shape-content.md` 的最终 Brief 要求，更新 `overrides/conflicts.json` 中对应的 required-literal。`summary-shape-selector.md` 与 `baseline-*` 是原文匹配材料，保持不变。
3. 调整 `test/js/brief-preauthorization.test.js` 对新栏目、可选项、旧栏目缺席和双平台一致性的断言；保持既有授权测试语义。
4. 生成 Skill-Garden compiled targets，同步 `enhancements/0.6` 发布快照，再通过 Flower enhance-only 路径更新项目已启用的平台投影；核对来源、快照和 dogfood 一致。
5. 实施检查后更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 中的长期 Brief 合同。

## Compatibility And Risk

- 历史 brief 继续可读，下一次按现有规则刷新时才采用新结构。
- 当前任务在实施前仍用现行 brief 模板完成规划评审；新模板随源与投影更新后生效。
- Patch selector 仍匹配 Trellis 上游原文；若改写 selector，会使安装或编译目标失配，因此只改注入内容和最终产物断言。
- Flower dogfood 更新必须在源与快照核验后执行，并检查计划只涉及预期受管文件，避免覆盖任务目录中的用户数据。

## Validation

- 运行定向 brief 文案测试、Patch 冲突检查与 compiled targets 校验，核对 Codex/Claude 及其它已启用平台最终栏目一致。
- 运行项目测试与 `git diff --check`，确认快照和 dogfood 无非预期变更。
- 用一份有技术设计和一份轻量 PRD-only 的任务材料人工核对栏目归属、技术概览可选性与无重复要求。

## Rollback

如栏目语义或投影验证失败，回退作者源、Patch 内容与断言，再重新生成 compiled targets、快照和 dogfood；历史任务不需迁移或回滚。
