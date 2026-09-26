# 精简任务 Brief 栏目并补充技术方案概览

## Goal

让任务交接摘要在减少栏目重复的同时，直接说明技术方案如何运转，使接手者能快速判断范围、原理、关键取舍和验收条件。

## Background

当前 `trellis-task-brief` 把 `Key Decisions` 与 `Key Context` 分列，并把延期事项与风险合放在 `Risks / Deferred`。`Scope` 的宽泛写法也容易复述方案、取舍或验收；同时，仅列入口文件和决定不足以呈现方案的主流程。`trellis-brainstorm` 的交接约束、冲突断言、测试和项目规范也依赖现有栏目名称。

## Requirements

- R1. 保留一句话的 `Goal` 和独立的 `Scope`。`Goal` 表达任务目的，`Scope` 只列本轮纳入的行为或改动对象，不复述方案原理、取舍或验收；不引入 `Deliverables` 栏目。
- R2. 将 `Key Decisions` 与 `Key Context` 合并为 `Context & Decisions`：只保留影响实施判断的既有事实、入口、硬约束及已收敛的取舍和原因，不复制完整决策台账。
- R3. 新增 `Technical Overview`，简述触发入口、主要处理或数据流、关键校验及结果，使读者理解方案原理；只从已有规划材料提炼，不引入新设计。规划材料没有明确技术机制的轻量任务可省略整节。
- R4. 将 `Risks / Deferred` 改为可选的 `Risks`。本轮明确延期的工作归入 `Non-Goals`；`Risks` 只记录实施或验证时仍需关注的具体风险，没有风险时省略整节。
- R5. `Non-Goals` 表达范围边界，`Acceptance` 表达可验证的完成条件；仅当某项边界确实需要回归验证时，才在验收中写对应的负向条件，避免同义复述。
- R6. Codex 与 Claude 的 brief 规则、`trellis-brainstorm` 最终交接约束及相关校验保持一致；源、发布快照、编译目标和本项目已启用的投影同步一致。
- R7. 保持 `brief.md` 来源于 `prd.md`、存在时的 `design.md` 和 `implement.md`，以及现有的完整展示、确认、auto-loop 和任务启动门禁。

## Acceptance Criteria

- [ ] 新模板保留一句话 `Goal` 和只列改动范围的 `Scope`，不新增 `Deliverables`；包含 `Technical Overview` 与 `Context & Decisions`，不再生成独立的 `Key Context`、`Key Decisions` 或 `Risks / Deferred` 栏目。
- [ ] 有明确技术机制的复杂任务能用简短概览讲清主流程；没有来源依据的轻量任务可省略概览，且不臆造技术事实。
- [ ] 延期事项与非目标、风险与验收各有明确归属；不需要验证的负向范围声明不在验收中重复。
- [ ] Codex/Claude 作者源、brainstorm 约束、冲突断言、测试、编译目标、发布快照和 dogfood 投影中的栏目语义一致，相关检查通过。
- [ ] 历史 brief、规划评审授权规则和 `task.py start` 的新鲜度门禁保持原有行为。

## Out of Scope

- 不批量改写已创建或归档任务的 `brief.md`。
- 不引入新的 brief 生成脚本或新的任务启动字段校验。
- 不改变三件套权威性、规划确认时机、auto-loop 授权例外或其它任务文档模板。
