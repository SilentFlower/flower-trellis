# 升级 Trellis 0.6.1 并修正 skill-garden 兼容

## Goal

将 flower-trellis 捆绑的 `@mindfoldhq/trellis` 升级到 0.6.1，并修正 skill-garden 0.6 强化内容中仍引用 Trellis 0.6.0 `Phase 3.1 Quality verification` 的覆盖语义。升级后，skill-garden 的工作流覆盖、路由 skill、同步快照和当前安装副本都应使用 Trellis 0.6.1 的语义：3.1 已折叠进 2.2 final pass 与 3.4 spec-sync preamble。

## Requirements

- `package.json` / `package-lock.json` 使用 `@mindfoldhq/trellis@0.6.1`。
- `.trellis/.version` 更新到 `0.6.1`，并通过 Trellis 0.6.1 模板更新自动可更新文件。
- 手动保留本仓本地配置：`.trellis/config.yaml` 的 packages / `codex.dispatch_mode`，`.codex/hooks.json` 的 SessionStart hook，以及 finish-work release override 注入块。
- 修正 skill-garden 0.6 覆盖源、`enhancements/0.6/` 快照、当前项目 `.agents/` 与 `.claude/` 已安装副本中仍把 `Phase 3.1` 描述为 final verification 的内容。
- `trellis-route` 的语义应改为：普通 `target=check` 属于 Phase 2.2；Phase 3.1 不再是工作流步骤，最终复查只在用户显式要求、2.2 结果缺失、check 后代码变更或高风险时回到 check 路由。
- workflow 正文应补齐 0.6.1 语义：2.2 的最后一次检查必须 full-scope；3.4 起草提交前先做 spec-sync preamble 判断。skill-garden 状态块只保留短守卫，不重复版本迁移解释。
- 排查 skill-garden 强化内容的剩余冲突时，只统计会影响强化包行为、安装结果或路由判断的冲突；不把普通 Trellis 0.6.0 / 0.6.1 上游模板副本差异本身列为未解决项。
- `trellis-continue` 中 `check passed → 3.1` 的上游残留暂不修，等待 Trellis 上游修复；本任务只记录为已知排除项。
- 不移除 finish-work release inference / `trellis-release` 强化能力。
- 不修改 Trellis 上游源码或 npm 全局安装目录。

## Acceptance Criteria

- [ ] `npm view @mindfoldhq/trellis@0.6.1 version` 显示 0.6.1，`package.json` / lockfile 依赖也固定为 0.6.1。
- [ ] `trellis update --dry-run` 不再显示项目版本为 0.6.0；如仍有 modified-by-you 项，均为本仓需要保留的本地配置或 skill-garden 注入。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`、`workflow-states/in_progress*.md`、`.agents/.claude` 的 `trellis-route` 源不再把 `Phase 3.1` 当作存在的 final verification 步骤。
- [ ] `enhancements/0.6/` 与 `vendor/skill-garden/.trellis/0.6/` 中对应 workflow override、route skill 文件一致。
- [ ] 当前安装副本 `.agents/skills/trellis-route/SKILL.md`、`.claude/skills/trellis-route/SKILL.md` 与 `enhancements/0.6` 对应文件一致。
- [ ] `.trellis/workflow.md` 中 skill-garden 覆盖块与 in_progress 状态块不再把已删除的 3.1 当作常规 final verification 步骤；0.6.1 的 final pass / spec-sync 语义保留在 workflow 正文和 hub 中。
- [ ] 排查结果说明除已处理项外，skill-garden 强化内容是否还有 0.6.1 行为冲突。
- [ ] 验证通过：`npm run sync`、`node scripts/check-snapshot.mjs`、`node --check src/cli.js`、`for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`、`git diff --check`、`python3 ./.trellis/scripts/task.py validate 06-17-trellis-061-skill-garden-compat`。

## Notes

- Trellis 0.6.1 是模板 / 文档重构版，不需要 `--migrate`。
- 截至 2026-06-17，npm registry 的 `latest` 已是 0.6.2；本任务目标仍是按用户要求固定升级到 0.6.1，不用 latest 作为验收依据。
- 用户明确关心 skill-garden 强化内容和 Trellis 0.6.1 语义之间的真实冲突，而不是所有上游模板副本差异。
- `trellis-continue` 的 3.1 恢复指向是上游 0.6.1 包内残留，按用户要求本次不修。
