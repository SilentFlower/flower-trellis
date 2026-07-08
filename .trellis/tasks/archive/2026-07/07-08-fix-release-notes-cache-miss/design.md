# 修复 flower-update release notes 缓存缺失 - 设计

## Boundary

改动集中在 `src/lib/self-check.js` 的缓存命中路径。`src/lib/update-check.js` 已提供带超时和失败静默的 `fetchPackageUpdateMetadata()` 以及 release notes 聚合函数,不需要新增网络层或持久化格式。用户要求 actionable 更新提示在缓存缺摘要时必须主动查 npm 远端,registry 有目标版本摘要就必须展示。

## Flow

1. `buildSelfCheck()` 先保持现有本地版本读取和远程缓存新鲜度判断。
2. 在缓存新鲜、无新版推荐、项目 `projectOutOfSync` 的分支中,先按现有逻辑尝试 `cachedReleaseNotes(updateCheck, releaseNotesRange)`。
3. 如果缓存命中摘要,直接复用,保持零网络。
4. 如果缓存没有摘要且 `releaseNotesRange` 有效,调用 `fetchPackageUpdateMetadata()` 补拉一次 registry 根 metadata,只用返回的 `releaseNotesByVersion` 生成摘要。
5. 如果补拉得到可用摘要,在本次结果中携带非空 `releaseNotes.versions`,并在 `writeCache && manifest` 时只写回 `lastReleaseNotes`。
6. 如果补拉失败或摘要不可用,在本次结果中返回 `buildReleaseNotesSummary(null, releaseNotesRange)` 形态的结构化 unavailable 摘要,让 hook 输出 `release_notes_unavailable: true`。
7. 补拉失败或摘要不可用时不刷新 `lastCheckedAt` / `lastRemote` / `lastStatus` / `lastErrorCode`,避免把“为摘要做的补拉失败”误写成远程版本证据失败。

## Trade-offs

- 不把 `lastReleaseNotes: null` 视为整个远程缓存不新鲜,因为 dist-tags 仍是有效远程证据;但 actionable 输出没有摘要时必须主动补拉 npm metadata。
- 不修改 hook 代码,但 self-check 在补拉失败/无摘要时返回结构化 unavailable 对象,复用 hook 现有 `release_notes_unavailable: true` 输出能力。

## Compatibility

- manifest 结构不变。
- `lastRemote` 仍只保存 dist-tags。
- 失败路径继续遵守“网络尽力而为,不阻断主流程”的约定。
