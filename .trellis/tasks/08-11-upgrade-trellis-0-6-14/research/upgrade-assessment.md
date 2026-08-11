# Trellis 0.6.14 升级评估证据

## Upstream Sources

- 正式 tag：`https://github.com/mindfold-ai/trellis/releases/tag/v0.6.14`
- 差异范围：`https://github.com/mindfold-ai/trellis/compare/v0.6.12...v0.6.14`
- `0.6.13` migration manifest：`packages/cli/src/migrations/manifests/0.6.13.json`
- `0.6.14` migration manifest：`packages/cli/src/migrations/manifests/0.6.14.json`

两个 manifest 均声明非 breaking、无需独立 migration。上游有效改动集中在跨平台 session identity、SessionStart 更新提示、平台 configurator 文档、Hook 平台检测/matcher、压缩会话 memory 恢复和 Grok reader。

## Current Flower Baseline

- `package.json` 精确依赖 `@mindfoldhq/trellis: 0.6.12`。
- `vendor/skill-garden/.trellis/0.6/overrides/compatibility.json` 只登记 `0.6.12`。
- `vendor/skill-garden/compiled-targets/0.6.12/full` 是当前 all-platform canonical fixture。
- 上一轮升级任务：`.trellis/tasks/archive/2026-08/08-02-assess-trellis-0-6-12-upgrade/`。

## Mechanical Preflight

对官方 `0.6.14` all-platform fixture 运行当前 Patch catalog，出现 20 条 required 失败：

1. `.trellis/scripts/common/session_context.py`：
   - `session-context-update-helpers` selector 为 0 次匹配。
   - `session-context-update-output` selector 为 0 次匹配。
2. `trellis-meta-managed-platform-skill-roots`：18 个平台输出的 section fingerprint 失配。

未发现第三类 required 根因。预检保持 zero-write。

## Semantic Conflict

上游把 `_get_update_hint` 重构为公开 `get_update_hint(repo_root, context_key)`，并让共享 `session-start.py` 组装 `<first-reply-notice>` 时携带更新提示。当前 Flower Patch 只移除 `session_context.py` 中的旧实现，不能单靠 selector 重定基线解决：

- 保留 helper 会出现 Trellis 原生更新提示，与 Flower update/self-update owner 冲突。
- 只删除 helper 会让共享 SessionStart 依赖 ImportError 静默跳过，留下失真的死路径和不足的最终断言。

因此需要同时处理 session context API 和 9 份共享 SessionStart relay，保留 notice 本体。

## Compatible Areas

- Flower 深层导入使用的 `collectPlatformTemplates`、`getConfiguredPlatforms`、`ALL_MANAGED_DIRS`、`shouldExcludeFromBackup` 等导出在 `0.6.12` 与 `0.6.14` 间保持兼容。
- `ALL_MANAGED_DIRS` 没有导致 Flower update snapshot 闭包发生 API 级破坏。
- Flower 没有 Patch `packages/core/src/mem`，memory runtime 可通过依赖升级直接继承。
- Active Task 与 shared Hook 的现有 selector 大多仍能命中，但其相邻上游行为必须通过最终产物测试保护。

## Isolated Test Evidence

隔离副本同时安装 `@mindfoldhq/trellis@0.6.14` 与 `@mindfoldhq/trellis-core@0.6.14` 后：

- CLI/控制/update/platform 定向测试 57 项中 56 项通过。
- 唯一失败断言把升级输出写死为 `0.6.5 -> 0.6.12`，实际输出为 `0.6.5 -> 0.6.14`。
- 另一组平台/Patch 测试的 5 项失败均由上述两类 required preflight 冲突触发。
- 当前 Flower update dry-run 会在 Plugin replay 阶段因 required Patch 失败而停止，说明 fail-closed 与 zero-write 保护按设计工作。

## Assessment

升级不需要重构 Flower CLI 或 Plugin Runtime，属于中等工作量。主要实施风险是 SessionStart 更新提示所有权，其次是 Active Task 新 session identity 的组合回归；Meta 文档和硬编码版本更新属于低风险机械项。
