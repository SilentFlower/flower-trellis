# 强制 Codex dispatch_mode 为 sub-agent 实施计划

## Checklist

- [x] 启动任务: `python3 ./.trellis/scripts/task.py start 06-16-force-codex-dispatch-sub-agent`。
- [x] 修改 `src/lib/codex-tweaks.js`:
  - [x] 新增幂等写入 `.trellis/config.yaml` 的 helper。
  - [x] 在 `.codex/` 存在时设置 `codex.dispatch_mode: sub-agent`。
  - [x] 扩展 `applyCodexTweaks()` 返回值。
- [x] 修改 `src/lib/apply-enhancements.js` 的 Codex 调整输出,报告 dispatch mode 是否已强制。
- [x] 修改 `trellis-route` skill 文案:
  - [x] `.agents/skills/trellis-route/SKILL.md`
  - [x] `.claude/skills/trellis-route/SKILL.md`
  - [x] `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
  - [x] `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- [x] 修改 `in_progress-inline` workflow-state 文案:
  - [x] `.trellis/workflow.md`
  - [x] `enhancements/0.6/overrides/workflow-states/in_progress-inline.md`
  - [x] `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- [x] 运行 `npm run sync` 更新 `enhancements/0.6` 快照和 `enhancements/MANIFEST.json`。
- [x] 用临时目标触发 `applyEnhancements()` dogfood,确认 Codex 目标配置被强制且重复执行幂等。

## Validation

- [x] `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
- [x] 在临时目标验证有 `.codex/` 且无真实 `codex` 块时会写入 `dispatch_mode: sub-agent`。
- [x] 在临时目标验证已有 `codex.dispatch_mode: inline` 时会覆盖为 `sub-agent`。
- [x] 在临时目标验证没有 `.codex/` 时不新增 `codex` 配置。
- [x] 验证 repeated run 不产生二次 diff。
- [x] `diff -u .agents/skills/trellis-route/SKILL.md .claude/skills/trellis-route/SKILL.md`
- [x] `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`

## Risk Points

- `config.yaml` 是用户配置文件,编辑必须保留其它内容。
- `npm run sync` 会重建 enhancements 快照,需要核对 diff 只包含预期的 skill 文案和 manifest 时间/commit。
- 当前会话仍是 inline 注入,实现阶段开始后按 workflow 需要先走 `trellis-route(implement)`。
