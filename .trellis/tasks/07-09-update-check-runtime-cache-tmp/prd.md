# 迁移 updateCheck 运行缓存到 tmp

## Goal

把启动更新检查中会频繁变化的运行缓存从 `.trellis/.flower-manifest.json` 迁移到 gitignored 的 `.tmp` 文件，避免 `lastCheckedAt`、远端版本缓存和 release notes 缓存每次启动或联网检查后污染 git，同时保留现有更新检查、节流、release notes 补拉和策略管理语义。

## Background

- 当前用户侧实际问题：`.trellis/.flower-manifest.json` 因 `updateCheck.lastCheckedAt` 等缓存字段变化而持续出现在 `git status` 中。
- 当前仓库证据：`src/lib/manifest.js:15` 的 `DEFAULT_UPDATE_CHECK` 把策略字段和缓存字段放在同一个对象；`src/lib/manifest.js:130` 的 `readUpdateCheck()` 只读 manifest；`src/lib/manifest.js:141` 的 `writeUpdateCheck()` 直接把完整 `updateCheck` 写回 manifest。
- 当前消费者：`src/lib/self-check.js:35` 用 `lastCheckedAt` / `lastRemote` / `lastStatus` / `lastErrorCode` 判断远程缓存新鲜度；`src/lib/self-check.js:51` 用 `lastReleaseNotes` 复用摘要；`src/lib/update-check.js:351` 的 `rememberRemoteTags()` 在 `init` / `update` 启动探测成功后写远程缓存；`src/commands/update-check.js:36` 的 `get` 展示完整配置。
- 当前文档和规范仍写旧契约：`README.md:134` 说明策略和缓存统一保存在 `.trellis/.flower-manifest.json`；`.trellis/spec/flower-trellis/cli/config-and-state.md:127` 同样把 `updateCheck` 描述为用户策略与运行缓存。
- `.trellis/.gitignore` 已忽略 `*.tmp`，适合存放开发者本地 / 项目本地运行缓存。

## Requirements

- R1: `.trellis/.flower-manifest.json` 的 `updateCheck` 只保留用户策略字段：`enabled`、`policy`、`intervalHours`。
- R2: 运行缓存字段必须迁移到 gitignored 文件，字段包括：`lastCheckedAt`、`lastRemote`、`lastReleaseNotes`、`lastStatus`、`lastErrorCode`。
- R3: 新缓存文件使用固定路径 `.trellis/.flower-update-check.tmp`；该路径必须被现有 `.trellis/.gitignore` 的 `*.tmp` 规则忽略，不需要新增 git 跟踪文件来保存缓存。
- R4: `readUpdateCheck(target)` 对调用方仍返回兼容的合并视图，包含策略字段和缓存字段，避免 `self-check`、`checkForUpdate()`、`update-check get` 等消费者大范围改签名。
- R5: 兼容旧 manifest：如果 `.flower-update-check.tmp` 不存在，但旧 `.trellis/.flower-manifest.json` 的 `updateCheck` 内仍有缓存字段，读取时可以临时复用这些旧字段，确保 interval 节流、缓存远端版本和 release notes 不会在升级后立刻丢失。
- R6: 必须清理旧 manifest 字段：任意写入型路径写入 `updateCheck` 或重写 manifest 时，都要把 `lastCheckedAt`、`lastRemote`、`lastReleaseNotes`、`lastStatus`、`lastErrorCode` 从 `.trellis/.flower-manifest.json` 中移除。
- R7: 写入缓存字段时只更新 `.trellis/.flower-update-check.tmp`；除了一次性清理旧 manifest 缓存字段外，后续联网检查不得因为缓存变化修改 `.trellis/.flower-manifest.json`。
- R8: 写入策略字段时只更新 `.trellis/.flower-manifest.json` 中的 `enabled`、`policy`、`intervalHours`，并保留已有策略语义：`disable` 只写 `enabled=false`，`enable` 只写 `enabled=true`，`set --policy off` 继续同步 `enabled=false`。
- R9: `writeManifest(target, data)` 在全装或项目重叠加时必须保留旧策略字段，但不得把旧缓存字段继续写回 manifest；这也是老项目清理缓存字段的主要升级路径。
- R10: `readManifest()` 仍只表示安装清单；目标没有 `.flower-manifest.json` 时，缓存写入不得凭空创建半截 manifest，保持现有 `rememberRemoteTags()` / `self-check` 容错边界。
- R11: `update-check get` 应继续展示合并后的 `updateCheck` 配置和缓存，便于诊断；输出中应明确标出 manifest 路径和缓存 tmp 路径。
- R12: README 和 `.trellis/spec/flower-trellis/cli/config-and-state.md` 必须更新为新契约，旧任务文档无需回改。
- R13: 现有 release notes 补拉规则不得回退：补拉成功只写 `lastReleaseNotes` 缓存；补拉失败或无摘要不得刷新 `lastCheckedAt` / `lastRemote` / `lastStatus`。
- R14: 迁移后重复执行 `self-check` 或 `init/update` 的远程缓存刷新，不应导致 `.trellis/.flower-manifest.json` 出现仅由运行缓存引起的 git diff。

## Out of Scope

- 不改变 `updateCheck` 的策略枚举、默认值或 AI 行为模式。
- 不改变 npm registry 探测、latest / beta 推荐、release notes 聚合和安全门槛逻辑。
- 不新增数据库、全局用户目录缓存或后台进程。
- 不回写历史归档任务文档。

## Acceptance Criteria

- [ ] 从含旧缓存字段的 `.trellis/.flower-manifest.json` 读取时，`readUpdateCheck()` 能返回旧 `lastCheckedAt` / `lastRemote` / `lastReleaseNotes` 等缓存值。
- [ ] 触发任意写入型路径后，`.trellis/.flower-manifest.json` 的 `updateCheck` 只包含 `enabled`、`policy`、`intervalHours`，旧缓存字段被清除。
- [ ] 远程探测成功、离线失败、release notes 补拉成功等缓存写入都落到 `.trellis/.flower-update-check.tmp`，该文件不进入 git 跟踪。
- [ ] 重复运行更新检查时，除了第一次清理旧 manifest 字段外，`.trellis/.flower-manifest.json` 不再因为 `lastCheckedAt` 或缓存内容变化产生 diff。
- [ ] `update-check get` 输出仍包含完整合并视图，并能说明策略来自 manifest、缓存来自 tmp。
- [ ] `update-check set|disable|enable` 保持既有策略语义，并不会把缓存字段写回 manifest。
- [ ] README 和 CLI 配置状态规范描述新持久化位置、兼容迁移和旧字段清理规则。
- [ ] `node --check src/lib/manifest.js src/lib/self-check.js src/lib/update-check.js src/commands/update-check.js` 通过；相关 CLI 场景验证通过。
