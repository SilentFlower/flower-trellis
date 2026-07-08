# 支持 skill-garden hook override

## Goal

让 skill-garden 可以分发并覆盖 Trellis 平台 hook 文件,从而支持后续维护
`inject-workflow-state.py`、`session-start.py` 等 hook 级增强,而不是只能覆盖
workflow / workflow-state / skill / scripts。

本任务的首个使用场景是:对 shared `inject-workflow-state.py` 增加 Codex 条件判断。
当项目已由 flower 注册 Codex 主 `SessionStart` hook 时,不再在 no_task 场景每轮注入
`<trellis-bootstrap>` 要求读取 `trellis-start`;没有主 `SessionStart` hook 的 Codex 项目仍保留
该兜底提示。

## Background / Confirmed Facts

- 当前 `trellis-start` 的定位是:平台没有 session-start hook 时,让 AI 手动加载等价
  Trellis 启动上下文。
- 当前重复提示来自 `.codex/hooks/inject-workflow-state.py` / `.claude/hooks/inject-workflow-state.py`
  中的 `CODEX_NO_TASK_BOOTSTRAP_NOTICE`,不是来自 `trellis-start` skill 自身。
- Trellis 上游 `node_modules/@mindfoldhq/trellis/dist/templates/codex/hooks.json` 默认只注册
  `UserPromptSubmit`,不注册 Codex `SessionStart`。
- flower-trellis 的 `src/lib/codex-tweaks.js` 会在 Codex 目标上合并
  `.codex/hooks/session-start.py` 到 `hooks.SessionStart`,matcher 为
  `startup|resume|clear|compact`。
- 当前 skill-garden 源 `vendor/skill-garden/.trellis/0.6/overrides/` 只包含 workflow、
  workflow-state、skill override 和 scripts,没有 hook override 分发机制。
- 当前 enhancements 快照也没有 `overrides/hooks/` 目录。

## Requirements

- R1: skill-garden 源应支持声明 hook override 文件,并由 `npm run sync` 同步到
  `enhancements/<variant>/overrides/hooks/`。
- R2: flower-trellis 的 `applyEnhancements()` 应在全装时应用 hook override,且过程幂等。
- R3: hook override 应支持 shared hook 场景,首批至少能把一个 shared
  `inject-workflow-state.py` override 同步到已存在的平台 hook 位置:
  `.codex/hooks/inject-workflow-state.py` 和 `.claude/hooks/inject-workflow-state.py`。
- R4: hook override 不应创建未启用的平台目录。只有目标平台目录和目标 hook 文件已存在时才覆盖。
- R5: hook override 覆盖必须遵守现有备份策略:首次覆盖前保留原文件到
  `.trellis/.backup-flower/<原相对路径>`,后续重复运行不刷新首次备份。
- R6: 首个 hook override 的 `inject-workflow-state.py` 必须保留 `<codex-mode>` 和
  `<workflow-state>` 输出,只对 `<trellis-bootstrap>` 增加条件判断。
- R7: Codex `<trellis-bootstrap>` 注入条件为:platform 为 `codex`、当前无 active task、且
  `.codex/hooks.json` 未注册主 `.codex/hooks/session-start.py` 的 `SessionStart` hook。
- R8: 如果 `.codex/hooks.json` 损坏、缺失或 `.codex/hooks/session-start.py` 文件不存在,
  应保守保留 `<trellis-bootstrap>` 兜底提示。
- R9: 变更必须同步项目规范,说明 hook override 的目录约定、应用边界、幂等和备份规则。
- R10: 现有 workflow / skill override / scripts / flower assets 行为不得回退。

## Decisions

- D1: hook override 目录约定采用 `overrides/hooks/shared/<file>`。shared override 表示同一个
  hook 文件可应用到多个已启用平台;后续如某个平台需要特殊版本,再扩展
  `overrides/hooks/<platform>/<file>` 作为平台专属覆盖。
- D2: 本任务需要补 `design.md` 和 `implement.md`。原因是实现会同时影响 skill-garden 源、
  enhancements 快照、全装叠加、备份和幂等验证。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.trellis/0.6/overrides/hooks/` 中存在本任务定义的 hook override 源。
- [ ] 运行 `npm run sync` 后,`enhancements/0.6/overrides/hooks/` 与 skill-garden 源保持一致。
- [ ] `flower-trellis update/init` 全装路径会把 hook override 应用到已有 `.codex` / `.claude`
  hook 文件,重复运行不产生重复内容或重复备份。
- [ ] 目标缺少 `.codex/`、`.claude/` 或对应 hook 文件时,hook override 跳过且不创建平台目录。
- [ ] Codex 已注册主 `SessionStart` hook 时,模拟 no_task `UserPromptSubmit` 输出不包含
  `<trellis-bootstrap>`,但包含 `<codex-mode>` 和 `<workflow-state>`。
- [ ] Codex 未注册主 `SessionStart` hook 时,模拟 no_task `UserPromptSubmit` 输出仍包含
  `<trellis-bootstrap>`。
- [ ] Python hook 语法检查通过。
- [ ] Node ESM 语法检查通过。
- [ ] `git diff --check` 通过。

## Out of Scope

- 不删除 `trellis-start` skill。
- 不修改 Trellis 上游 npm 包或 `node_modules`。
- 不在本任务中设计所有平台的完整 hook override 矩阵;首批只覆盖已讨论的 shared
  `inject-workflow-state.py` 场景。
- 不引入运行时 marker 来证明 SessionStart 已在当前会话实际执行过;本任务只根据 hook 注册和文件存在判断。

## Open Questions

- 暂无。
