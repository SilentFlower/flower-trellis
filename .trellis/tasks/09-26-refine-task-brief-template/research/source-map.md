# Brief 模板源与投影调查

- 权威 skill 源：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-task-brief/SKILL.md` 与同级 `.claude` 副本，现有内容逐字节相同；运行副本位于项目 `.agents/`、`.claude/` 和 `enhancements/0.6/`。
- `trellis-brainstorm` 的最终 Brief 栏目由 `vendor/skill-garden/.trellis/0.6/overrides/patches/skills/trellis-brainstorm/planning-handoff/summary-shape-content.md` 注入。相邻 `summary-shape-selector.md` 是上游目标原文匹配材料，应保留原字节。
- `vendor/skill-garden/.trellis/0.6/overrides/conflicts.json` 对 Codex/Claude 的 brainstorm 结果断言旧栏目；`test/js/brief-preauthorization.test.js` 也断言旧模板内容。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的 Planning Brief 合同记载旧栏目；项目规范应在实施后按 Phase 3.3 更新。
- 分发路径为作者源、`npm run patch:targets` 生成 compiled targets、`npm run sync` 生成 `enhancements/0.6/`、Flower enhance-only update 更新本项目 dogfood。`scripts/sync-enhancements.mjs` 会重建快照，不能手工只改快照。
- 现有 `task.py start` brief guard 只检查存在与相对规划文件的新鲜度，未校验栏目形状；历史 brief 无迁移要求。
