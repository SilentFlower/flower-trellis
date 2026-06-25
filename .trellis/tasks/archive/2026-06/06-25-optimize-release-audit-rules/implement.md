# 优化 trellis-release 与 finish-work 上线核对规则 - Implement

## Implementation Checklist

1. 修改 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md`：
   - 加入交叉核对步骤。
   - 加入文档漂移处理规则。
   - 加入 `YYYY-MM-DD-<release-slug>.md` 命名规则和冲突处理。
   - 更新上线单模板，加入核对摘要 / 风险标记。
2. 将同样内容同步到 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md`。
3. 修改 `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`：
   - 明确上下文压缩 / 会话恢复后必须重新读取文件和 git 证据。
   - 明确已存在 `release.md` 也要做漂移核对。
   - 明确不确定但有风险时标记 `Needs human review`。
4. 运行 `npm run sync`，刷新 `enhancements/0.6/`。
5. 同步当前项目已安装副本：
   - `.agents/skills/trellis-release/SKILL.md`
   - `.claude/skills/trellis-release/SKILL.md`
   - `.agents/skills/trellis-finish-work/SKILL.md`
   - `.claude/commands/trellis/finish-work.md`
6. 检查源、快照、当前副本的关键文本一致。

## Validation

```bash
npm run sync
diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md enhancements/0.6/.agents/skills/trellis-release/SKILL.md
diff -u vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md enhancements/0.6/.claude/skills/trellis-release/SKILL.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md enhancements/0.6/overrides/skills/trellis-finish-work.md
rg -n "YYYY-MM-DD-<release-slug>|漂移|上下文压缩|Needs human review|核对摘要" vendor/skill-garden/.trellis/0.6 enhancements/0.6 .agents .claude
git status --short
```

## Rollback Points

- 源文件修改可通过 git diff 逐项回滚。
- `npm run sync` 会重建 `enhancements/`；如输出异常，先回滚源文件再重新同步。
- 当前项目已安装副本只用于本仓库 dogfood，必要时可再次从源文件同步。
