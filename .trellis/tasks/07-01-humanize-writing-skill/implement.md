# 沉淀 humanize-writing skill 实施计划

## Checklist

1. 参考 `/root/.codex/skills/test/SKILL.md` 的临时来源，确认不沿用其占位 frontmatter。
2. 在 `vendor/skill-garden/.trellis/0.6/.agents/skills/humanize-writing/` 创建正式 skill，更新 frontmatter，并把原英文版完整规则体系翻译/中文化为中文润色规则主体。
2.1. 在规则主体后补充返回前自检与反模式章节，增强 skill 的通用可执行性。
3. 将同一内容复制到 `vendor/skill-garden/.trellis/0.6/.claude/skills/humanize-writing/`。
4. 为增强 skill 枚举抽取小型 lib，读取变体快照中的 `.agents/skills` 与 `.claude/skills` 并合并名称。
5. 新增 `src/commands/skill.js`，实现 `list` 与 `install` 两个子命令。
6. 更新 `src/cli.js`，识别 `ft skill list` / `ft skill install ...`，并更新 help 文案。
7. 运行 `npm run sync` 生成 `enhancements/0.6` 快照。
8. 将正式 skill 同步到当前项目 dogfood 副本 `.agents/skills/humanize-writing/` 与 `.claude/skills/humanize-writing/`。
9. 验证 `.agents` 与 `.claude` 源副本一致，`vendor` 与 `enhancements` 快照一致，并抽查 33 类规则、自检、反模式没有遗漏。
10. 运行静态和差异检查，确认没有无关改动。
11. 为 `scripts/check-snapshot.mjs` 补充 dirty submodule 门禁，防止快照来自未提交 skill-garden 源。

## Validation Commands

```bash
npm run sync
cmp -s vendor/skill-garden/.trellis/0.6/.agents/skills/humanize-writing/SKILL.md vendor/skill-garden/.trellis/0.6/.claude/skills/humanize-writing/SKILL.md
cmp -s vendor/skill-garden/.trellis/0.6/.agents/skills/humanize-writing/SKILL.md enhancements/0.6/.agents/skills/humanize-writing/SKILL.md
cmp -s vendor/skill-garden/.trellis/0.6/.claude/skills/humanize-writing/SKILL.md enhancements/0.6/.claude/skills/humanize-writing/SKILL.md
for f in src/lib/*.js src/commands/*.js; do node --check "$f" || exit 1; done
node --check src/cli.js
node bin/flower-trellis.js skill list --target .
node bin/flower-trellis.js skill install humanize-writing --target .
git diff --check
node --check scripts/check-snapshot.mjs
```

如需验证可选安装路径，使用本地临时 Trellis 项目执行 `flower-trellis skill install humanize-writing` 或等价本地命令；如果当前环境不适合创建临时目标，至少检查 `src/lib/skill-filter.js` 的完整名称匹配逻辑和 `skill install` 到 `applyEnhancements` 的参数传递。

## Risky Files and Rollback Points

- `vendor/skill-garden/.trellis/0.6/` 是真实源。实现必须先改这里。
- `enhancements/0.6/` 是生成快照。不要手改快照后忘记同步源。
- `.agents/skills/` 与 `.claude/skills/` 是当前项目 dogfood 副本，必须与源文件保持一致。
- 回滚时删除新增 skill 目录并重新运行 `npm run sync`。
