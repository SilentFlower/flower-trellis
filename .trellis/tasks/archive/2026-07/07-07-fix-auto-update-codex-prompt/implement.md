# 修正自动更新检查与 Codex 提示行为 - Implement

## Checklist

1. 更新 `src/lib/self-check.js`
   - 先计算 `projectOutOfSync` 但不提前返回。
   - 缓存过期或 `--force-remote` 时先联网获取 dist-tags。
   - 远端版本高于当前本地版本时优先返回 `update_available`,推荐完整 self-update。
   - 远端无新版且项目 out-of-sync 时返回 `project_out_of_sync`,推荐 `--project-only`。
   - 增加 `project.outOfSync` / `project.outOfSyncReasons`。

1.1 更新 `src/lib/update-check.js`
   - `checkForUpdate()` 成功取得 dist-tags 后,刷新已有 manifest 的 `updateCheck.lastRemote` / `lastCheckedAt` / `lastStatus`。
   - 写缓存失败不阻断 `init` / `update`;目标无 manifest 时不创建半截 manifest。
   - 尊重 manifest 的 `updateCheck.enabled=false` / `policy=off`。

1.2 修复失败缓存语义
   - `fetchPackageDistTags()` timeout 从 2.5 秒提高到 5 秒,减少 registry 偶发慢响应误判。
   - `self-check` 遇到 `lastStatus=offline` 或 `lastErrorCode` 时不使用 interval 缓存短路。
   - 远端探测失败只写 `lastStatus=offline` / `lastErrorCode=fetch_failed`,不刷新 `lastCheckedAt`。
   - `flower_update_hook.py` 内部执行 `self-check` 的 subprocess timeout 改为 30 秒。

2. 更新 `src/assets/flower_update_hook.py`
   - 输出 `ai_mode` 和更强的 `ask` 指令。
   - `policy=ask` 时把 `systemMessage` 写成确认阻塞提示。
   - `<flower-update>` 首部增加 `priority` 与 `instruction_scope`。
   - 输出项目 out-of-sync 证据和远端不可确认信息。
   - 保持 Codex SessionStart JSON schema 不增加额外顶层字段。

3. 更新 `src/lib/codex-tweaks.js`
   - 将 Trellis 主上下文 hook 归位到 `matcher: "startup|resume|clear|compact"`,timeout 30。
   - 将 flower 更新检查 hook 归位到 `matcher: "startup"`,timeout 30。
   - 迁移旧的无 matcher group,避免同一命令重复注册。

4. 更新规范
   - `.trellis/spec/flower-trellis/cli/config-and-state.md`: 远端缓存/联网顺序、完整 self-update 优先级、hook ask 文案验证。
   - `.trellis/spec/flower-trellis/cli/enhancements-model.md`: Codex matcher / timeout 合并幂等规则。

5. 验证
   - `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`
   - `python3 -m py_compile src/assets/flower_update_hook.py`
   - 用假 `flower-trellis self-check --json` 驱动 `src/assets/flower_update_hook.py`,确认 stdout 合法 JSON 且无 `additional_context` 顶层字段。
   - 断言 hook 输出的 `systemMessage` 与 `additionalContext` 包含 `policy=ask` 的阻塞确认标记。
   - 构造/检查 `.codex/hooks.json` 合并结果,确认两个 SessionStart hook 的 matcher/timeout 正确且无旧重复 group。
   - 用临时 Trellis 目标验证 `checkForUpdate()` 成功探测会刷新 `updateCheck.lastRemote`,且 `policy=off` 时不联网不写缓存。
   - 构造 `offline/fetch_failed` 新鲜缓存,验证 `self-check` 会重新尝试远端探测。
   - mock 远端探测失败,验证 manifest 不刷新 `lastCheckedAt`。
   - `git diff --check`

## Risk Points

- `buildSelfCheck()` 当前分支较多,调整顺序时要避免破坏 disabled / skipped / npx / offline 路径。
- 写 cache 时要维持 manifest 存在判断和离线失败容错。
- Codex hook group 迁移必须保留用户自定义 hooks。
- `self-update --project-only` 现有行为不应改变;只改变推荐命令选择时机。

## Review Gate

实现前确认:

- PRD 已包含完整更新优先级。
- `design.md` 已说明状态流和 hook 迁移策略。
- `implement.jsonl` / `check.jsonl` 包含真实规范和 research 条目。
