# Brief — 精简任务 Brief 栏目并补充技术方案概览

## Goal

- 精简任务交接摘要的重复栏目，并增加能说明技术方案运行原理的概览。

## Scope

- 调整 Skill-Garden 0.6 的任务 Brief 栏目与内容提取规则，覆盖 Codex、Claude 和本项目投影的规划交接入口。

## Non-Goals

- 不批量改写历史 `brief.md`，不新增生成脚本或任务启动字段校验。
- 不改变三件套权威性、规划确认、auto-loop 授权例外及其它任务文档模板。

## Key Decisions

- `Goal` 保持一句话；`Scope` 只列本轮纳入的改动，不设置 `Deliverables` 栏目。
- `Technical Overview` 简述入口、主要流程、关键校验与结果；来源未明确技术机制的轻量任务可省略，不在 brief 中发明设计。
- `Context & Decisions` 说明必要现状、约束与最终取舍及原因；已在技术概览说明的流程不重复写入。
- 延期事项进入 `Non-Goals`；`Risks` 只写仍需关注的风险；负向验收仅在边界需要回归验证时保留。

## Key Context

- 权威源位于 `vendor/skill-garden/.trellis/0.6/`；`trellis-brainstorm` 的 `summary-shape-content.md`、`overrides/conflicts.json` 与 `test/js/brief-preauthorization.test.js` 引用了旧栏目。
- 分发经 compiled targets、`npm run sync` 发布快照及 Flower enhance-only dogfood 更新；`summary-shape-selector.md` 与 baseline 是原文匹配材料，需保持不变。

## Risks / Deferred

- Patch 断言与注入内容若不同步，编译或安装会失败；dogfood 更新前需确认只触及预期受管文件。

## Acceptance

- 新模板保留一句话 `Goal` 和仅列改动范围的 `Scope`，不新增 `Deliverables`；包含 `Technical Overview` 和 `Context & Decisions`，不再生成三个旧独立栏目。
- 有设计的任务能说明原理，缺少依据的轻量任务可省略概览；各栏目不重复复述相同要求。
- Codex/Claude、brainstorm、冲突断言、测试、编译目标、快照与 dogfood 语义一致，相关检查通过。
- 历史 brief、完整展示与确认规则、`task.py start` 新鲜度门禁保持原行为。

## Next Step

- 确认 Brief 后启动任务，先修改 Skill-Garden 的 brief 作者源。
