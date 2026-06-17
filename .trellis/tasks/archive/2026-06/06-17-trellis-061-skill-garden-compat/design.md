# 设计：Trellis 0.6.1 兼容与 skill-garden 覆盖语义修正

## 总体方案

本任务分两层处理：

1. Trellis 版本层：将本仓依赖和 `.trellis/.version` 升级到 0.6.2，使用 0.6.2 update 刷新可自动更新的模板文件。
2. skill-garden 强化层：保留本仓已有的 workflow override、finish-work release override、`trellis-route`、`trellis-push` 等强化能力，但把其中 Trellis 0.6.0 的 `Phase 3.1 final verification` 表述改为 0.6.1 语义。

## 0.6.1 目标语义

Trellis 0.6.1 删除 `Phase 3.1 Quality verification` 常规步骤，保留编号空洞。原有价值拆到：

- Phase 2.2：任务最后一次检查必须是 full-scope final pass，覆盖全部受影响 package / spec Quality Check。
- Phase 3.4：起草提交前执行 spec-sync preamble，判断是否需要先回 Phase 3.3 写 spec。

skill-garden 的覆盖规则应基于这个模型，但不在每次注入的 workflow-state 短块里重复完整版本迁移解释：

- `trellis-route(target=check)` 仍可在 Phase 2.2 作为 check/check-all 模式选择入口。
- 不再描述 “At Phase 3.1 final verification”。
- 若需要最终复查，应表达为“提交前或检查后变更触发的 on-demand re-check”，触发后回到 Phase 2.2 / check route，而不是进入 3.1。
- 0.6.1 的 full-scope final pass 和 spec-sync preamble 保留在 workflow 正文与 skill-garden hub；`workflow-states/in_progress*.md` 只保留 route / post-check / commit gate 短守卫。

## 0.6.2 follow-up

Trellis 0.6.2 只补 0.6.1 漏掉的 `/continue` 路由模板：`status=in_progress + check passed` 不再恢复到已删除的 3.1，而是恢复到 Phase 3.3（spec update）→ 3.4（commit）。本仓应允许 `trellis update` 自动更新 `.agents/skills/trellis-continue/SKILL.md` 与 `.claude/commands/trellis/continue.md`，继续保留 `.trellis/workflow.md`、finish-work override、`.trellis/config.yaml`、`.codex/hooks.json` 等本地改动。

## 修改范围

### 版本与模板

- `package.json`
- `package-lock.json`
- `.trellis/.version`
- `trellis update` 自动更新的 `trellis-meta` change-workflow 文档
- `trellis update` 自动更新的 `.agents/skills/trellis-continue/SKILL.md`
- `trellis update` 自动更新的 `.claude/commands/trellis/continue.md`

### skill-garden 源

- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`

### 快照与当前安装副本

- `enhancements/0.6/...` 对应文件由 `npm run sync` 生成。
- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`
- `.trellis/workflow.md` 中已注入的 skill-garden override 与 workflow-state 块。

## 冲突排查规则

本任务只把以下内容算作“还需修”的冲突：

- skill-garden 源、快照或当前安装副本仍引用已删除的 `Phase 3.1` 作为常规工作流步骤。
- 强化逻辑会绕开 0.6.1 的 2.2 final pass 或 3.4 spec-sync preamble。
- install / sync / snapshot 会把旧语义重新写回目标项目。
- route、push、finish-work 等 skill-garden skill 的描述会导致 AI 执行顺序与 0.6.1 workflow 冲突。

以下不算本任务未解决冲突：

- 普通 Trellis 上游模板副本从 0.6.0 到 0.6.1 的自然差异。
- `.trellis/config.yaml` packages、Codex SessionStart、finish-work release override 这类本仓刻意保留的本地配置差异。
- `trellis-continue` 里 `check passed → 3.1` 的上游 0.6.1 残留；按用户要求等上游修复，本任务不改本地副本。
- 已归档历史任务里的旧描述。

## 风险与取舍

- `.trellis/workflow.md` 被 skill-garden 修改过，`trellis update` 会要求人工决定；不能直接 force overwrite，否则会丢 skill-garden hub。
- finish-work 入口同样被 release override 修改过，升级模板时应保留注入块。
- `trellis-route` 是 skill-garden 自定义 skill，不在 Trellis 0.6.1 原生模板内；必须从 vendor 源改，再同步到 snapshot 和当前副本。

## 回滚方案

- 回退 `package.json` / lockfile / `.trellis/.version` 到 0.6.1 或 0.6.0，视需要回退的范围决定。
- 回退 vendor/skill-garden 对应提交，重新运行 `npm run sync`。
- 恢复 `.trellis/workflow.md` 中旧的 skill-garden 注入块和当前 route skill 副本。
