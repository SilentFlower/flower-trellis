# 优化 trellis-push 实施计划

## Implementation Checklist

- [x] 读取 `trellis-before-dev` 和相关 CLI/spec 约束。
- [x] 对比当前 `.agents`、`.claude`、`vendor/skill-garden`、`enhancements` 中的 `trellis-push/SKILL.md`，确认基线一致。
- [x] 重构 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md` 的流程结构，将 snapshot 进度草案纳入统一执行计划。
- [x] 将同样内容同步到 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`。
- [x] 同步当前项目 `.agents/skills/trellis-push/SKILL.md` 和 `.claude/skills/trellis-push/SKILL.md`。
- [x] 运行 `npm run sync` 更新 `enhancements/` 快照和 `enhancements/MANIFEST.json`。
- [x] 校验所有 `trellis-push/SKILL.md` 副本一致。
- [x] 运行项目约定校验。

## Validation

- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md .agents/skills/trellis-push/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md enhancements/0.6/.agents/skills/trellis-push/SKILL.md`
- `npm run sync`
- `node scripts/check-snapshot.mjs`（发布前检查；当前会因 `enhancements/` 尚未提交而按预期失败，提交后再通过）
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`

## Validation Results

- `npm run sync`：通过。
- 所有 `trellis-push/SKILL.md` 副本 diff：通过，无差异。
- `node --check ...`：通过。
- `node scripts/check-snapshot.mjs`：未通过，原因是 `enhancements/` 存在本任务未提交改动；该脚本设计为发布前检查，要求快照已提交后才通过。
- Check-all 过程中发现统一计划模板缺少“AI 本轮编辑 / 未识别 dirty 文件”分组，已修复并重新同步快照。
- Check-all 过程中澄清 `git: true` 是 Trellis 上下文展示独立包仓库状态的配置，不应作为 `trellis-push` 的唯一仓库发现规则；已改为“父仓根目录始终参与 + 实际独立 Git root 作为额外候选”。
- 提交阶段注意：本任务改了 `vendor/skill-garden` submodule 源。最终提交时应先让 submodule 产生新 commit，再回到父仓重跑 `npm run sync`，确保 `enhancements/MANIFEST.json.sourceCommit` 指向新的 submodule HEAD。

## Review Gates

- 开始实现前：用户确认 PRD、设计和实施计划。
- 完成实现后：先执行 Trellis check，再按 Phase 3.4 走 `trellis-push`。
