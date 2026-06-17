# 实施计划：Trellis 0.6.2 + skill-garden 兼容

## 步骤

1. 升级 Trellis 依赖与项目版本
   - 将 `@mindfoldhq/trellis` 升级到 `0.6.2`。
   - 更新 lockfile。
   - 运行 0.6.2 `trellis update`，对冲突文件选择保留 / 手工合并，不覆盖本仓本地配置。

2. 合并 0.6.1 workflow 语义
   - `.trellis/workflow.md` 删除常规 `3.1 Quality verification` 表述。
   - Phase Index 中 1.3 改为 `[required · once]` 并保留 inline skip 说明。
   - Phase 2.2 增加 final pass 语义。
   - Phase 3.4 增加 spec-sync preamble。
   - 保留 skill-garden push / post-check / finish-work 显式触发规则。

3. 修正 skill-garden 覆盖源
   - 更新 `overrides/workflow.md` 的 scope 与 routing gate，不再写 “Phase 3.1 final verification”。
   - 更新 `workflow-states/in_progress*.md`，不再引用 3.1，也不重复 full-scope / spec-sync 的版本迁移说明。
   - 更新 `.agents` / `.claude` 的 `trellis-route` 源。

4. 同步快照与当前副本
   - 运行 `npm run sync`。
   - 同步当前 `.agents/skills/trellis-route` 与 `.claude/skills/trellis-route`。
   - 必要时重新注入 `.trellis/workflow.md` 的 skill-garden override / workflow-state 块。

5. 排查剩余 skill-garden 冲突
   - 搜索 `vendor/skill-garden/.trellis/0.6`、`enhancements/0.6`、`.agents/skills`、`.claude/skills`、`.trellis/workflow.md` 中的 `Phase 3.1`、`Quality verification`、`Final pass`、`Spec-sync`。
   - 排除历史任务、普通模板副本、intentional local config，以及用户要求暂不修的 `trellis-continue` 上游残留。
   - 记录最终结论。

6. 补齐 0.6.2 continue 修复
   - 通过 `trellis update` 自动刷新 `.agents/skills/trellis-continue/SKILL.md` 与 `.claude/commands/trellis/continue.md`。
   - 验证 `check passed` 不再路由到 3.1，而是路由到 Phase 3.3 → 3.4。

## 验证命令

```bash
npm run sync
node scripts/check-snapshot.mjs
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
git diff --check
python3 ./.trellis/scripts/task.py validate 06-17-trellis-061-skill-garden-compat
npx --yes @mindfoldhq/trellis@0.6.2 update --dry-run
```

## 重点文件

- `package.json`
- `package-lock.json`
- `.trellis/.version`
- `.trellis/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `enhancements/0.6/**`
- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`
- `.agents/skills/trellis-continue/SKILL.md`
- `.claude/commands/trellis/continue.md`
