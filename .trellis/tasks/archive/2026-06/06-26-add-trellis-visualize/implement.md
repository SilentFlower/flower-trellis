# 新增 trellis-visualize 并替换 draw-uml - Implement

## Checklist

- [x] 读取任务上下文：`prd.md`、`design.md`、`implement.md`、`implement.jsonl`。
- [x] 对比 `architecture-diagram/architecture-diagram/SKILL.md` 和 `templates/template.html`，提取可迁移的设计系统规则。
- [x] 在 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-visualize/SKILL.md` 编写新 skill。
- [x] 复制到 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-visualize/SKILL.md`，确保两份内容一致。
- [x] 删除 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-draw-uml/`。
- [x] 删除 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-draw-uml/`。
- [x] 更新 `vendor/skill-garden/README.md` 的 Trellis 0.6 技能清单：`trellis-draw-uml` -> `trellis-visualize`。
- [x] 运行 `npm run sync` 更新 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
- [x] 将 0.6 源 skill 同步到当前项目 `.agents/skills/trellis-visualize/` 和 `.claude/skills/trellis-visualize/`，并删除当前项目旧 `trellis-draw-uml/` 副本。
- [x] 验证 `old` / `0.5` 变体没有被修改。
- [x] 验证 flower-trellis 全量升级清理：含旧 `.trellis/.flower-manifest.json` 的目标项目在重新叠加 0.6 后会删除旧 `trellis-draw-uml` 并记录 `trellis-visualize`。

## Validation

```bash
diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-visualize/SKILL.md \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-visualize/SKILL.md

diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-visualize/SKILL.md \
  enhancements/0.6/.agents/skills/trellis-visualize/SKILL.md

diff -u \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-visualize/SKILL.md \
  enhancements/0.6/.claude/skills/trellis-visualize/SKILL.md

diff -u \
  vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-visualize/SKILL.md \
  .agents/skills/trellis-visualize/SKILL.md

diff -u \
  vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-visualize/SKILL.md \
  .claude/skills/trellis-visualize/SKILL.md

test ! -e vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-draw-uml
test ! -e vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-draw-uml
test ! -e enhancements/0.6/.agents/skills/trellis-draw-uml
test ! -e enhancements/0.6/.claude/skills/trellis-draw-uml
test ! -e .agents/skills/trellis-draw-uml
test ! -e .claude/skills/trellis-draw-uml

rg "trellis-draw-uml|draw-uml" \
  vendor/skill-garden/.trellis/0.6 enhancements/0.6 .agents .claude vendor/skill-garden/README.md

git diff -- \
  vendor/skill-garden/.trellis/old \
  vendor/skill-garden/.trellis/0.5 \
  enhancements/old \
  enhancements/0.5

git diff --check
git -C vendor/skill-garden diff --check
```

说明：`rg "trellis-draw-uml|draw-uml"` 预期不应命中 0.6 和当前副本中的旧入口；若命中 `old` / `0.5`，不属于本任务删除范围。

升级清理验证建议使用临时目标项目，构造旧 manifest 中包含 `.agents/skills/trellis-draw-uml` / `.claude/skills/trellis-draw-uml` 的场景，再运行全量增强叠加。不要用 `--skills` 验证清理，因为该模式按设计不清理 stale paths。

## Risky Files

- `vendor/skill-garden/.trellis/0.6/**`
- `enhancements/0.6/**`
- `enhancements/MANIFEST.json`
- `.agents/skills/**`
- `.claude/skills/**`
- `vendor/skill-garden/README.md`

## Rollback Points

- 修改 `vendor/skill-garden/.trellis/0.6` 前记录 submodule `git -C vendor/skill-garden status --short`。
- `npm run sync` 后检查快照 diff，若范围异常，先还原源文件再重新 sync。
- 当前项目 `.agents` / `.claude` 副本只从 0.6 源复制，若需要回滚，可重新从 `enhancements/0.6` 或源目录恢复。

## Verification Log

- `npm run sync`：通过，0.6 `claude/skills=12`、`agents/skills=12`。
- `diff -u`：0.6 源 `.agents` / `.claude`、源与 `enhancements/0.6`、源与当前项目副本均一致。
- `rg "trellis-draw-uml|draw-uml" vendor/skill-garden/.trellis/0.6 enhancements/0.6 .agents .claude vendor/skill-garden/README.md`：无命中。
- `git diff -- vendor/skill-garden/.trellis/old vendor/skill-garden/.trellis/0.5 enhancements/old enhancements/0.5`：无输出。
- 临时目标项目 manifest 清理验证：旧 `.agents/skills/trellis-draw-uml` / `.claude/skills/trellis-draw-uml` 被删除，新 manifest 包含 `trellis-visualize`。
- `git diff --check && git -C vendor/skill-garden diff --check`：通过。
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`：通过。
