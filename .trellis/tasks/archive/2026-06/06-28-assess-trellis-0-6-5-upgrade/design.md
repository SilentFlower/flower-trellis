# Trellis 0.6.5 升级设计

## 目标边界

本任务的实现目标是把 flower-trellis 的捆绑 Trellis 从 `0.6.2` 升级到 `0.6.5`，并把 0.6.5 的上游模板变化与本仓 skill-garden 0.6 强化层合并到一致状态。

升级不应变成“接受上游覆盖”。本仓当前是三层结构：

1. flower-trellis wrapper 层：`src/`、`bin/`、`package.json`、`README.md`。
2. skill-garden 强化源层：`vendor/skill-garden/.trellis/0.6/`。
3. 发布快照和 dogfood 副本层：`enhancements/0.6/`、当前 `.agents/`、`.claude/`、`.trellis/workflow.md`。

实现时必须保持三层同步，避免只修当前项目而发布快照仍携带旧语义。

## 架构与改动面

### 1. 依赖层

修改：

- `package.json`
- `package-lock.json`

要求：

- `@mindfoldhq/trellis` 固定到 `0.6.5`。
- lockfile 中 `@mindfoldhq/trellis-core` 随之固定到 `0.6.5`。
- `node bin/flower-trellis.js -v` 应显示 bundled trellis 为 `0.6.5`。

### 2. flower 平台适配层

修改：

- `src/constants.js`
- `src/lib/pick-platforms.js`
- `README.md`
- 如有需要，更新 `.trellis/spec/flower-trellis/cli/config-and-state.md` 或相关 spec。

设计：

- `PLATFORM_FLAGS` 新增 `--devin`、`--zcode`、`--trae`。
- 保留 `--windsurf`，因为 Trellis 0.6.5 仍把它作为 deprecated alias。
- 不把 `--with-statusline` 放进 `PLATFORM_FLAGS`，它是 Claude Code feature flag，不是平台选择。
- 平台菜单把 `Windsurf` 改为 `Devin`，并新增 `ZCode`、`Trae`。

理由：

- 当前 flower 通过 `PLATFORM_FLAGS` 判断用户是否显式指定平台。若不识别新平台，用户传 `--zcode` / `--trae` / `--devin` 时仍可能被追加默认 `--codex --claude` 或弹出平台菜单。

### 3. 上游 Trellis 模板层

通过 Trellis 0.6.5 update 合并：

- `.trellis/scripts/common/active_task.py`
- `.trellis/scripts/common/cli_adapter.py`
- `.trellis/scripts/common/task_store.py`
- `.trellis/scripts/common/workflow_phase.py`
- `.trellis/scripts/common/safe_commit.py`
- `.trellis/scripts/add_session.py`
- `.claude/hooks/inject-workflow-state.py`
- `.claude/hooks/session-start.py`
- `.codex/hooks/inject-workflow-state.py`
- 上游自动更新的 `trellis-meta`、`trellis-session-insight`、`trellis-brainstorm`、`trellis-break-loop` 副本。

这些更新包含实际 bugfix：Kiro hook 注入、stdin 空输入不阻塞、Trae session key、Pi mem、safe commit 缩小 `.trellis` auto-commit staging 范围等，应接受上游。

### 4. 本地冲突层

这些文件必须手工合并，不能直接覆盖：

- `.trellis/workflow.md`
- `.trellis/config.yaml`
- `.codex/hooks.json`
- `.agents/skills/trellis-finish-work/SKILL.md`
- `.claude/commands/trellis/finish-work.md`

合并策略：

- `.trellis/config.yaml` 保留 `packages`、`default_package`、`codex.dispatch_mode: sub-agent`，同时保留/接收上游新增配置段。
- `.codex/hooks.json` 保留上游 `UserPromptSubmit`，继续由 flower 补 `SessionStart`。
- finish-work 保留 skill-garden release operations override；如果上游 finish-work 模板结构改变，更新 skill-garden override 注入源后再同步当前副本。
- `.trellis/workflow.md` 保留 skill-garden hub 与 state guards，同时吸收 0.6.5 平台矩阵、JSONL 门禁、pull-based dispatch 分类。

## Workflow 合并设计

0.6.5 上游 workflow 的有效变化：

- 平台矩阵增加 `ZCode`、`Reasonix`、`Trae`。
- `Windsurf` 在 agent-less / inline 分类中替换为 `Devin`。
- Phase 1.3 / 1.4 明确 sub-agent-dispatch 平台 `implement.jsonl` 与 `check.jsonl` 必须各有真实条目，seed row 不算 ready。
- Phase 2.1 将 `Gemini`、`Qoder`、`Copilot`、`ZCode`、`Reasonix`、`Trae` 放入 pull-based sub-agent block。
- Phase 2.2 check 矩阵补齐新平台。

skill-garden 覆盖的约束：

- Routing Gate、Task Brief Handoff、Post-Check Stop Gate、Code Commit Confirmation Gate、Push Progress Recovery / Snapshot 必须保留。
- workflow-state 中的 sentinel 块仍以 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md` 为源。
- 不新增第二套 skill-garden 顶层 hub；只修改现有 hub 和 state 源。

建议落点：

- 优先修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 和相关 `workflow-states/*.md`，让后续 `npm run sync` 生成快照。
- 当前 `.trellis/workflow.md` 通过 flower 注入逻辑刷新，或在必要时手工同步等效内容。

## 数据与状态兼容

- `.trellis/.runtime/`、`.trellis/.route-prefs.tmp` 不应纳入提交。
- `trellis-route` 的任务隔离由随 skill 分发的 `route_state.py` 负责：`resolve` 校验 runtime 决策的 task / target / source / mode / scope；`write` 在写入当前任务任一 target 前清理同一 session 中属于其他任务的 `route_decisions`。workflow/state 文案保持轻量的 target-matched 规则，避免把可测试状态逻辑扩散到 prompt。
- `.trellis/tasks/**` 是当前任务记录，按 Trellis 流程保留。
- `.trellis/.flower-manifest.json` 可能因 dogfood update 变化，需在最终 diff 中判断是否属于本次合理产物。
- 0.6.3 的 Windsurf -> Devin migration 只有项目存在 `.windsurf/` 时才需要 `trellis update --migrate`。当前研究未发现本仓需要迁移 `.windsurf/`，实现时仍需检查。

## 关键取舍

- 接受上游 Python runtime 和 bundled skill 更新，因为它们是 0.6.5 bugfix 的主体。
- 不接受上游 workflow / config / hooks / finish-work 的整文件覆盖，因为它们包含本仓稳定运行所依赖的本地定制。
- 平台列表在 flower 层手工对齐上游，避免 wrapper 在 0.6.5 新平台下产生错误默认平台追加。

## 回滚方案

- 依赖升级回滚：恢复 `package.json` / `package-lock.json` 中 `@mindfoldhq/trellis@0.6.2`。
- Trellis 模板回滚：用 git 回滚 `.trellis/`、`.agents/`、`.claude/`、`.codex/` 的本次改动。
- skill-garden 回滚：恢复 `vendor/skill-garden/.trellis/0.6/` 源，再运行 `npm run sync` 回退 `enhancements/0.6/`。
- flower 平台列表回滚：恢复 `src/constants.js`、`src/lib/pick-platforms.js`、README。

## 验证策略

基础验证：

```bash
node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
npm run sync
node scripts/check-snapshot.mjs
node bin/flower-trellis.js -v
node bin/flower-trellis.js update --dry-run --no-update-check
git diff --check
```

一致性验证：

```bash
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md enhancements/0.6/overrides/workflow-states/in_progress.md
diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md enhancements/0.6/.agents/skills/trellis-route/SKILL.md
diff -u enhancements/0.6/.agents/skills/trellis-route/SKILL.md .agents/skills/trellis-route/SKILL.md
```

人工 diff 重点：

- `.trellis/workflow.md` 是否保留 skill-garden hub，并吸收 0.6.5 平台矩阵。
- `.trellis/config.yaml` 是否保留 monorepo package 配置。
- `.codex/hooks.json` 是否同时包含上游 `UserPromptSubmit` 和 flower `SessionStart`。
- finish-work override 是否仍存在。
