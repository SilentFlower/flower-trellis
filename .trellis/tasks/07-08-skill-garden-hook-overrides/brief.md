# Brief — 支持 skill-garden hook override

## Goal

- 让 skill-garden 可以通过 `overrides/hooks/shared/<file>` 分发并覆盖 Trellis 平台 hook 文件,首个场景是让 Codex 已有主 `SessionStart` hook 时不再每轮注入 `trellis-start` bootstrap。

## Scope

- 新增 skill-garden hook override 源路径 `vendor/skill-garden/.trellis/0.6/overrides/hooks/shared/inject-workflow-state.py`。
- 同步快照到 `enhancements/0.6/overrides/hooks/shared/inject-workflow-state.py`,并补充 sync manifest 的 hook override 统计。
- 新增 flower-trellis 运行时 hook override 注入模块,在全装时把 shared hook override 覆盖到已有 `.codex/hooks/inject-workflow-state.py` 和 `.claude/hooks/inject-workflow-state.py`。
- 在 override 版 `inject-workflow-state.py` 中根据 `.codex/hooks.json` 是否注册 `.codex/hooks/session-start.py` 的 `SessionStart` hook 决定是否注入 `<trellis-bootstrap>`。
- 同步当前 dogfood 项目 hook 副本和项目规格。

## Non-Goals

- 不删除 `trellis-start` skill。
- 不修改 Trellis 上游 npm 包或 `node_modules`。
- 不设计所有平台完整 hook override 矩阵;首批只覆盖 shared `inject-workflow-state.py`。
- 不引入运行时 marker 来证明 SessionStart 已在当前会话实际执行过。

## Key Context

- `trellis-start` 是无 SessionStart 平台的手动启动上下文兜底;当前重复提示来自 `inject-workflow-state.py` 的 `CODEX_NO_TASK_BOOTSTRAP_NOTICE`。
- 上游 Trellis 0.6.5 Codex `hooks.json` 默认只注册 `UserPromptSubmit`,flower 的 `codex-tweaks.js` 才补主 `SessionStart`。
- 目录决策:使用 `overrides/hooks/shared/<file>` 作为首批约定;未来需要平台差异时再扩展 `overrides/hooks/<platform>/<file>`。
- hook override 是覆盖已有 Trellis hook,不是 flower 自有资产,不写入 manifest `paths`,避免升级清理误删上游原生 hook。
- 实现需沿用 `preserveFirstBackup()` 首次备份和内容一致不写盘的幂等模式。

## Acceptance

- `vendor/skill-garden/.trellis/0.6/overrides/hooks/shared/` 和 `enhancements/0.6/overrides/hooks/shared/` 都包含本任务 hook override。
- 全装路径会覆盖已有 `.codex` / `.claude` hook 文件,重复运行不重复写入或刷新备份。
- 目标缺少平台目录或对应 hook 文件时跳过,不创建平台目录。
- Codex 已注册主 `SessionStart` hook 时,no_task `UserPromptSubmit` 输出无 `<trellis-bootstrap>`,但保留 `<codex-mode>` 和 `<workflow-state>`。
- Codex 未注册主 `SessionStart` hook 时,no_task 输出仍包含 `<trellis-bootstrap>`。
- Node 语法检查、Python py_compile、幂等验证和 `git diff --check` 通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后,运行 `task.py start` 进入 `in_progress`;随后按 Phase 2.1 进入 `trellis-route(implement)`。
