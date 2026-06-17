# Implement — 修正 2.2/3.1 检查路由边界

## 执行清单

- [x] 更新 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`，把 routing gate 改为 2.1 implement + 2.2 check，3.1 仅 final verification。
- [x] 更新 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`。
- [x] 更新 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`。
- [x] 同步更新 `enhancements/0.6/overrides/**` 对应文件。
- [x] 更新 `vendor/skill-garden/.trellis/0.6/.agents/.claude` 中的 `trellis-route` skill 源。
- [x] 运行 `npm run sync` 由 vendor 源重新生成 `enhancements/` 快照。
- [x] 同步更新 `.trellis/workflow.md` 当前项目注入后的 hub/state 文案。
- [x] 更新四份 `trellis-route` skill 副本：
  - `.agents/skills/trellis-route/SKILL.md`
  - `.claude/skills/trellis-route/SKILL.md`
  - `enhancements/0.6/.agents/skills/trellis-route/SKILL.md`
  - `enhancements/0.6/.claude/skills/trellis-route/SKILL.md`
- [x] 搜索旧语义残留。
- [x] 验证 vendor/enhancements 覆盖文件一致。
- [x] 运行 JS 语法检查。

## 验证命令

```bash
rg -n "Phase 2\\.2.*not a standalone|Phase 3\\.1.*route|final check/check-all routing|2\\.2.*implement-loop" \
  .trellis/workflow.md enhancements/0.6 vendor/skill-garden/.trellis/0.6 \
  .agents/skills/trellis-route/SKILL.md .claude/skills/trellis-route/SKILL.md

diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md enhancements/0.6/overrides/workflow-states/in_progress.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md enhancements/0.6/overrides/workflow-states/in_progress-inline.md

node --check src/cli.js
for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
```

## 回滚点

- 若 0.6 覆盖语义导致 route skill 与当前 workflow 冲突，可仅回滚本任务修改的 workflow/skill 文案文件。
- 不触碰现有 `sync-global-trellis-version` 任务相关代码改动。
