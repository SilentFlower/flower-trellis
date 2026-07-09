# Brief — 迁移 updateCheck 运行缓存到 tmp

## Goal

- 把 `updateCheck` 中频繁变化的运行缓存从 `.trellis/.flower-manifest.json` 迁移到 gitignored 的 `.trellis/.flower-update-check.tmp`，避免 `lastCheckedAt` 等字段持续污染 git，同时保留现有启动更新检查语义。

## Scope

- 修改 `src/lib/manifest.js`，将 `updateCheck` 拆成 manifest 内的策略字段和 tmp 内的缓存字段。
- 保持 `readUpdateCheck(target)` 对调用方返回策略 + 缓存的合并视图。
- 兼容旧 manifest 中的缓存字段：读取时 fallback，写入时清理旧字段。
- 确认 `self-check`、`checkForUpdate()`、release notes 补拉和 `update-check` 命令仍走统一读写路径。
- 更新 `README.md` 和 `.trellis/spec/flower-trellis/cli/config-and-state.md` 的持久化契约。

## Non-Goals

- 不改变 `updateCheck` 的策略枚举、默认值或 AI 行为模式。
- 不改变 npm registry 探测、latest / beta 推荐、release notes 聚合和安全门槛逻辑。
- 不新增数据库、全局用户目录缓存或后台进程。
- 不回写历史归档任务文档。

## Key Context

- 当前问题证据：`.trellis/.flower-manifest.json` 因 `updateCheck.lastCheckedAt` 等缓存字段变化而持续出现在 `git status` 中。
- 当前集中入口：`src/lib/manifest.js` 的 `readUpdateCheck()` 和 `writeUpdateCheck()`。
- 运行缓存字段：`lastCheckedAt`、`lastRemote`、`lastReleaseNotes`、`lastStatus`、`lastErrorCode`。
- 策略字段：`enabled`、`policy`、`intervalHours`。
- 新缓存路径固定为 `.trellis/.flower-update-check.tmp`，由 `.trellis/.gitignore` 的 `*.tmp` 忽略。
- 读取不能写盘，避免 SessionStart 只读检查制造副作用；写入路径必须清理旧 manifest 缓存字段。

## Acceptance

- 从旧 manifest 读取时仍能复用旧缓存值。
- 任意写入型路径后，manifest 的 `updateCheck` 只剩策略字段。
- 缓存刷新写入 `.trellis/.flower-update-check.tmp`，后续不再因缓存变化修改 manifest。
- `update-check get` 展示合并视图，并标明 manifest 和 tmp 路径。
- `update-check set|disable|enable` 保持既有策略语义。
- README 和 CLI spec 描述新契约和旧字段清理规则。
- JS 语法检查、迁移场景验证和 `git diff --check` 通过。

## Next Step

- 用户确认 planning artifacts 和 brief 后，运行 `task.py start`，再进入 `trellis-route(implement)` 选择实现路线。
