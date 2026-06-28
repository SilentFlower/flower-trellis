# 统一路由状态复用机制实施计划

## Checklist

- [x] 复核现有 `trellis-route`、workflow hub、workflow-state 与 `d0749e1` 的语义边界。
- [x] 修改 vendor skill-garden 0.6 源：
  - [x] `.agents/skills/trellis-route/SKILL.md`
  - [x] `.claude/skills/trellis-route/SKILL.md`
  - [x] `overrides/workflow.md`
  - [x] `overrides/workflow-states/in_progress.md`
  - [x] `overrides/workflow-states/in_progress-inline.md`
- [x] 运行 `npm run sync`，同步 `enhancements/0.6` 快照。
- [x] 同步当前项目副本 `.agents/skills`、`.claude/skills` 和 `.trellis/workflow.md`。
- [x] 搜索并清理冲突或冗余文案：
  - [x] 无有效 route 时默认 inline check；
  - [x] compact summary / 用户口头 inline 可作为 route；
  - [x] check 失败后必须重新 route。
- [x] 更新任务文档状态。

## Validation

```bash
npm run sync
```

```bash
diff -u .agents/skills/trellis-route/SKILL.md .claude/skills/trellis-route/SKILL.md
```

```bash
diff -u enhancements/0.6/.agents/skills/trellis-route/SKILL.md enhancements/0.6/.claude/skills/trellis-route/SKILL.md
```

```bash
rg -n "default to inline check|默认 inline check|summary.*route|compact.*route|用户选择过.*route|check 失败.*重新.*route|rerun.*route" .trellis/workflow.md .agents .claude enhancements/0.6 vendor/skill-garden/.trellis/0.6
```

```bash
git diff --check
```

```bash
node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
```

```bash
node scripts/check-snapshot.mjs
```

说明：`check-snapshot.mjs` 是发布前置断言，会在 `enhancements/` 存在未提交改动时失败；开发阶段只用它确认失败原因是否为“快照未提交”，提交后再通过。

## Risky Files

- `.trellis/workflow.md`：会影响 per-turn workflow-state 注入。
- `trellis-route/SKILL.md` 多副本：必须保持 `.agents` / `.claude` / `enhancements` / vendor 源一致。
- `enhancements/MANIFEST.json`：`npm run sync` 会更新时间戳和 sourceCommit，需要核对是否符合快照策略。

## Notes

- 当前任务涉及 Trellis 自身强化包，源头应优先改 `vendor/skill-garden/.trellis/0.6`，再同步快照和本仓 dogfood 副本。
- 不要修改 `.trellis/.route-prefs.tmp`，它是开发者本地偏好。

## Additional Override Review Pass

- [x] 新增 `skill-garden-0.6-override-review.md`，保留 0.6 override 原文与建议文本对照，便于审查取舍。
- [x] 按讨论结论精简 `workflow.md` 的 `Routing Gate`：改为有效 route 决策合同、执行顺序、无效来源、复用范围、dispatch 边界。
- [x] 精简 `in_progress.md` / `in_progress-inline.md` 的 state guard：保留短硬门禁，明确 state block 是 breadcrumb，hub 是 source of truth。
- [x] 强化 `in_progress-inline.md`：明确 inline workflow-state 不是 inline route decision，不能因 helper 不可用或 state 名称默认 inline。
- [x] 小幅调整 `no_task.md`：保留并强化内置 Plan Mode 硬禁令，禁止调用 `EnterPlanMode` / `ExitPlanMode` 替代 Trellis planning。
- [x] 保留 state guard 中的 commit-only 提醒：`commit-without-push` 仍必须走 `trellis-push` commit-only mode。
- [x] 重新运行 `npm run sync`，同步 `enhancements/0.6` 与 `enhancements/MANIFEST.json`。
- [x] 用 `injectWorkflow` 刷新当前 `.trellis/workflow.md`，确认注入块与 `enhancements/0.6` 一致。
