# Brief — Assess Trellis 0.6.5 upgrade

## Goal

- 将 flower-trellis 的捆绑 Trellis 从 `@mindfoldhq/trellis@0.6.2` 升级到 `0.6.5`，并把上游 0.6.5 模板变化与本仓 skill-garden 0.6 强化层合并到一致状态。

## Scope

- 升级 `package.json` / `package-lock.json` 中的 `@mindfoldhq/trellis`，确保 lockfile 内 `@mindfoldhq/trellis-core` 同步为 `0.6.5`。
- 对齐 flower 平台选择层：`src/constants.js` 新增 `--devin`、`--zcode`、`--trae`，保留 `--windsurf`，不把 `--with-statusline` 作为平台 flag；`src/lib/pick-platforms.js` 将 `Windsurf` 改为 `Devin` 并新增 `ZCode`、`Trae`；同步 README 与必要 spec。
- 执行 Trellis 0.6.5 update，并接受上游 Python runtime、hooks、非 skill-garden 自定义覆盖的 bundled skill 修复。
- 手工合并 `.trellis/workflow.md`、`.trellis/config.yaml`、`.codex/hooks.json`、`.agents/skills/trellis-finish-work/SKILL.md`、`.claude/commands/trellis/finish-work.md`，避免上游整文件覆盖本地强化语义。
- 优先修改 `vendor/skill-garden/.trellis/0.6/` 源，再通过 `npm run sync` 同步 `enhancements/0.6/`，并同步当前 dogfood 的 `.trellis/workflow.md`、`.agents`、`.claude` 副本。

## Non-Goals

- 不实现 auto loop / 多任务自动跑功能。
- 不评估 0.5 或 old 强化包变体迁移。
- 不用 blanket overwrite 覆盖 workflow、config、hooks 或 finish-work override。
- 不裸 `git add`、`git commit`、`git push`；任务收尾提交必须走 `trellis-push`。

## Key Context

- 当前基线：`package.json`、`package-lock.json`、`.trellis/.version` 均为 Trellis `0.6.2`。
- 研究记录位于 `research/trellis-0-6-5-upgrade.md`；dry-run 已识别 modified-by-you 冲突文件包括 `.trellis/config.yaml`、`.trellis/workflow.md`、`.claude/commands/trellis/finish-work.md`、`.agents/skills/trellis-finish-work/SKILL.md`、`.codex/hooks.json`。
- 0.6.5 上游关键变化包括新平台 `--devin`、`--zcode`、`--trae`、`--with-statusline`，workflow 平台矩阵与 JSONL ready gate，pull-based dispatch 分类，Python hooks stdin 空输入修复，safe commit 缩小 `.trellis` auto-commit staging 范围，mem Pi adapter。
- 必须保留 skill-garden 规则：Task Brief Handoff、Routing Gate、Post-Check Stop Gate、Code Commit Confirmation Gate、Push Progress Recovery / Snapshot。
- 父仓与 `vendor/skill-garden` 分支都应在 `beta`，避免改动落到错误分支。

## Acceptance

- `@mindfoldhq/trellis` 和 `@mindfoldhq/trellis-core` 均升级并锁定到 `0.6.5`，`node bin/flower-trellis.js -v` 显示 bundled trellis 为 `0.6.5`。
- flower 平台列表支持 `--devin`、`--zcode`、`--trae`，继续兼容 `--windsurf`，且不会把 `--with-statusline` 当作平台选择。
- Trellis 0.6.5 Python runtime、hooks、相关上游 skill 修复已合并；本地 workflow/config/hooks/finish-work 覆盖没有被整文件覆盖或丢失强化语义。
- `vendor/skill-garden/.trellis/0.6/`、`enhancements/0.6/` 和当前 dogfood 副本保持同步。
- 验证命令通过：`node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`、`npm run sync`、`node scripts/check-snapshot.mjs`、`node bin/flower-trellis.js -v`、`node bin/flower-trellis.js update --dry-run --no-update-check`、`git diff --check`、`git -C vendor/skill-garden diff --check`，以及 implement.md 中列出的关键副本一致性 diff。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/06-28-assess-trellis-0-6-5-upgrade`，随后进入 Phase 2.1 并通过 `trellis-route(target=implement)` 决定实现路径。
