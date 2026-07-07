# Brief — 修正自动更新检查与 Codex 提示行为

## Goal

- 让 flower-trellis 启动自更新提示在 Codex 和 Claude Code 中一致、可审计且不误导:缓存过期时先查远端版本,再判断项目/本地版本;`policy=ask` 必须促使 AI 先问用户;Codex SessionStart hooks 使用明确 matcher。

## Scope

- 调整 `src/lib/self-check.js` 的状态流:项目版本不一致不再提前短路远端探测;缓存过期或 `--force-remote` 时先联网查 dist-tags。
- 同时存在远端新版和项目 out-of-sync 时,优先推荐完整 `self-update`,包含本地/全局 flower-trellis 包升级和项目内 Trellis / enhancement 重叠加,不得使用 `--project-only`。
- 在结果中保留项目 out-of-sync 证据,例如 `project.outOfSync` 和原因列表。
- 调整 `src/assets/flower_update_hook.py` 的 `<flower-update>` 文案,让 `policy=ask` 成为明确的阻塞确认要求。
- 调整 `src/lib/codex-tweaks.js` 的 `.codex/hooks.json` 合并逻辑:
  - `.codex/hooks/session-start.py`: `matcher: "startup|resume|clear|compact"`, `timeout: 30`
  - `.trellis/scripts/flower_update_hook.py`: `matcher: "startup"`, `timeout: 30`
  - 迁移旧的无 matcher group,避免重复注册。
- 同步更新 CLI 规范: `config-and-state.md` 与 `enhancements-model.md`。

## Non-Goals

- 不让启动 hook 直接执行 `npm i -g`、`flower-trellis update` 或 `flower-trellis self-update`。
- 不改变 Claude Code 的现有 hooks 合并策略。
- 不删除或重置用户自定义 Codex hooks。
- 不移除 `project_out_of_sync` 状态名。

## Key Context

- 当前分支: `beta-auto-update-codex-prompt`, base branch: `main`。
- 当前 bug 核心: `buildSelfCheck()` 在 `projectFlower !== currentFlower` 或 `projectTrellis !== currentTrellis` 时,会在联网前直接返回 `project_out_of_sync`,导致本地/项目版本低且远端更高时漏掉完整升级。
- Codex 官方资料确认 `SessionStart` matcher 过滤 start source,值包括 `startup`、`resume`、`clear`、`compact`;timeout 单位是秒。
- 相关文件:
  - `src/lib/self-check.js`
  - `src/assets/flower_update_hook.py`
  - `src/lib/codex-tweaks.js`
  - `.trellis/spec/flower-trellis/cli/config-and-state.md`
  - `.trellis/spec/flower-trellis/cli/enhancements-model.md`
- 风险点:自更新状态分支较多,需要保持 disabled / skipped / npx / offline 路径兼容;Codex hook 迁移必须保留用户自定义 hook。

## Acceptance

- `current_flower=0.4.3`、`project_flower=0.4.2`、远端 `latest=0.4.2` 时,不把结果描述为远端更新可用;清楚表达项目由旧 flower 铺设过,建议项目重叠加。
- 远端 `latest` 高于当前本地版本时,返回真正的 `update_available`,并推荐完整 self-update。
- `projectFlower !== currentFlower` 且远端 `latest` 高于当前本地版本时,缓存过期路径不得提前返回 `project_out_of_sync`;必须先联网并优先给出完整 self-update。
- 远端 `latest` 高于当前本地版本且项目也 out-of-sync 时,推荐命令不带 `--project-only`。
- 本地项目 out-of-sync 且远端探测离线/失败时,结果稳定、不中断 hook,并明确远端不可确认。
- Codex 收到 `policy=ask` 的 `<flower-update>` 后,注入内容包含必须停下询问的强约束。
- `.codex/hooks.json` 合并结果中两个 SessionStart hook 的 matcher / timeout 正确,且无旧的无 matcher 重复 group。
- 验证命令通过:
  - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
  - `python3 -m py_compile src/assets/flower_update_hook.py`
  - 假 `self-check --json` 驱动 `flower_update_hook.py`,stdout 为合法 JSON 且无 `additional_context` 顶层字段
  - `git diff --check`

## Next Step

- 用户确认 planning artifacts 和本 brief 后,运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-07-fix-auto-update-codex-prompt`,然后进入 Phase 2.1 `trellis-route(implement)`。
