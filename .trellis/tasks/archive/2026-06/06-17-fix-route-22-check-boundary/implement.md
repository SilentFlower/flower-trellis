# Implement — 修正 trellis-route 与 2.2 检查路由边界

## Checklist

- [x] 记录范围决策：只修 0.6 主路径，不修改 0.5 / legacy 文案。
- [x] 启动任务：`python3 ./.trellis/scripts/task.py start .trellis/tasks/06-17-fix-route-22-check-boundary`。
- [x] 进入实现前读取 `trellis-before-dev` 和相关 spec。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`。
- [x] 同步修改 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`。
- [x] 将 route skill 同步到 `.agents/skills/trellis-route/SKILL.md` 与 `.claude/skills/trellis-route/SKILL.md`。
- [x] 手工同步当前 `.trellis/workflow.md` 的 skill-garden hub 与 `workflow-state` 注入段。
- [x] 运行 `npm run sync` 更新 `enhancements/0.6` 与 `enhancements/MANIFEST.json`。
- [x] 确认 `src/lib/legacy-blocks.js`、`vendor/skill-garden/scripts/install.sh`、`enhancements/0.5/overrides/trellis-route.md` 未被本任务修改。
- [x] 更新 PRD 验收状态或记录未完成原因。

## Validation

- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md .agents/skills/trellis-route/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md .claude/skills/trellis-route/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md`
- `diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md enhancements/0.6/overrides/workflow-states/in_progress.md`
- `diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md enhancements/0.6/overrides/workflow-states/in_progress-inline.md`
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`
- `git diff --check`
- `git -C vendor/skill-garden diff --check`
- `node scripts/check-snapshot.mjs`

## Validation Result

- `npm run sync`：通过，已生成 `enhancements/0.6` 快照并更新 `enhancements/MANIFEST.json` 的 `syncedAt`。
- 六条副本一致性 `diff -u`：通过，输出为空。
- 旧语义残留搜索：通过，0.6 主路径内未再匹配 `Phase 2.1 / 2.2 / 3.1`、`2.1/2.2/3.1`、`before checking, route check`、`every check / check-all`、`已有本轮实现变更`、`dispatch routing`。
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`：通过。
- `git diff --check`：通过。
- `git -C vendor/skill-garden diff --check`：通过。
- `node scripts/check-snapshot.mjs`：未通过；该脚本是发布前检查，当前 `enhancements/` 快照存在本任务未提交改动时会要求先提交快照，未发现源/快照内容不一致。

## Risk Points

- 若只改当前 `.trellis/workflow.md`，后续 `npm run sync` 或 skill-garden 更新会把旧语义重新注入。
- 若只改 `.agents` 不改 `.claude`，Claude 与 Codex 行为会分叉。
- 若把 2.2 检查完全删除，会降低实现阶段质量门；本任务只移除 route 入口，不移除检查。
- 若未处理 `in_progress-inline` 的泛化文案，Codex inline 仍可能在 2.2 前误触发 route。
