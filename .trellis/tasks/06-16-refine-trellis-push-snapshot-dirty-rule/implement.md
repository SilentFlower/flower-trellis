# 调整 trellis-push snapshot bookkeeping 脏工作区规则 - 实施计划

## Implementation Checklist

- [x] 读取 `trellis-before-dev` 与 CLI/spec 约束。
- [x] 对比当前 0.6 `trellis-push/SKILL.md` 副本，确认同步源与当前副本关系。
- [x] 修改 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`：
  - [x] Step 1 预检说明改为记录父仓状态用于 staged/冲突/task 文件检查。
  - [x] Step 5.1 增加写入前目标 `task.json` / reconfigure `config.yaml` 预脏复核。
  - [x] Step 5.2 改为允许无关未暂存 dirty，阻塞无关 staged、冲突、目标文件预脏。
  - [x] Step 5.3 改为明确路径限定 bookkeeping commit。
  - [x] 计划模板、安全机制和反模式同步更新。
- [x] 同步 `.claude` 源、当前项目 `.agents` / `.claude` 副本。
- [x] 运行同步脚本更新 `enhancements/0.6` 快照和 manifest。
- [x] 校验所有 0.6 `trellis-push/SKILL.md` 副本一致。
- [x] 运行项目校验。

## Validation

- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md .agents/skills/trellis-push/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md .claude/skills/trellis-push/SKILL.md`
- `diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md enhancements/0.6/.agents/skills/trellis-push/SKILL.md`
- `node scripts/check-snapshot.mjs`
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`

## Validation Results

- 0.6 `trellis-push/SKILL.md` 副本 diff：通过，无差异。
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js scripts/*.mjs; do node --check "$f"; done`：通过。
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-16-refine-trellis-push-snapshot-dirty-rule`：通过。
- `git diff --check && git -C vendor/skill-garden diff --check`：通过。
- 临时 Git 仓库验证 `git commit --only -m ... -- <path>`：通过；只提交指定路径，已 staged 的其它文件仍保留在 staged 区。
- `node scripts/check-snapshot.mjs`：当前未通过，原因是 `enhancements/0.6/.../trellis-push/SKILL.md` 与 `enhancements/MANIFEST.json` 已按本任务重建但尚未提交；这是发布前检查对未提交快照 dirty 的预期阻断。

## Commit Notes

- 本任务改动包含 `vendor/skill-garden` submodule 工作区。提交阶段需要先在 submodule 内提交源 skill，再回到父仓重跑 `npm run sync`，使 `enhancements/MANIFEST.json.sourceCommit` 指向新的 submodule HEAD。
- 父仓提交应包含更新后的 submodule gitlink、当前项目 `.agents` / `.claude` 副本、`enhancements/0.6` 快照与本任务目录。

## Review Gates

- 开始实现前：用户确认本 PRD/design/implement 规划。
- 完成实现后：先执行 Trellis check，再按 Phase 3.4 走 `trellis-push`。

## Risk / Rollback

- 风险：文档放宽 unstaged dirty 后，AI 仍可能误用普通 commit。缓解：文档必须要求检查 staged 区并使用路径限定命令。
- Rollback：回退本任务修改的 `trellis-push/SKILL.md` 副本和同步快照。
