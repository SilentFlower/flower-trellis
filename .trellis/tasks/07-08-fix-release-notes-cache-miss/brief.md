# Brief — 修复 flower-update release notes 缓存缺失

## Goal

- 修复 SessionStart `<flower-update>` 在 `project_out_of_sync` 项目追平场景中漏出 release notes 的问题;缓存缺摘要时必须主动查询 npm registry,registry 有目标版本摘要就必须展示。

## Scope

- 修改 `src/lib/self-check.js` 的新鲜缓存命中路径:当最终会返回 `project_out_of_sync` 且 `cachedReleaseNotes()` 对 `projectFlower -> currentFlower` 返回 `null` 时,绕过 interval 主动调用一次 `fetchPackageUpdateMetadata()` 补拉 release notes。
- 补拉成功且目标范围有摘要时,本次结果返回非空 `releaseNotes.versions`,并在 `writeCache && manifest` 时只写回 `updateCheck.lastReleaseNotes`。
- 补拉失败或摘要不可用时,本次结果返回带当前 range 的结构化 `releaseNotes.unavailable=true`,继续返回原 `project_out_of_sync` 推荐命令。

## Non-Goals

- 不改变 `intervalHours: 8` 默认策略。
- 不改变 `<flower-update>` 字段协议、Codex SessionStart JSON schema 或推荐命令格式。
- 不为普通 `interval_not_elapsed` 场景补拉 release notes。
- 不修改 `flower_update_hook.py`;复用它现有的 `release_notes_unavailable: true` 输出能力。

## Key Context

- `src/lib/self-check.js:35` 的 `isRemoteCacheFresh()` 只判断远程 tags 缓存是否新鲜,不判断 release notes 是否满足本次输出。
- `src/lib/self-check.js:51` 的 `cachedReleaseNotes()` 在缓存摘要缺失、范围不匹配、unavailable 或版本列表为空时返回 `null`。
- `src/lib/self-check.js:405` 的 `projectOutOfSync` 缓存分支当前只复用缓存摘要,不会主动联网补拉。
- `src/lib/update-check.js` 已提供 `fetchPackageUpdateMetadata()` 和 `buildReleaseNotesSummary()`;网络失败必须尽力而为,不能阻断主流程。
- `lastRemote` 仍只保存 dist-tags;release notes 只能写入独立的 `lastReleaseNotes`。

## Acceptance

- 缓存新鲜 + `project_out_of_sync` + `lastReleaseNotes: null` + registry metadata 含目标版本 notes 时,`self-check --json` 主动查询 npm metadata,返回非空 `releaseNotes.versions`。
- 可用摘要会写回 `.trellis/.flower-manifest.json` 的 `updateCheck.lastReleaseNotes`,且不污染 `lastRemote`。
- 补拉失败或 registry metadata 缺目标摘要时,仍返回 `project_out_of_sync` 和推荐命令,同时返回 `releaseNotes.unavailable=true`,不刷新 `lastCheckedAt`,不写 `lastStatus=offline` 覆盖新鲜缓存。
- 已有匹配 release notes 时继续复用缓存,不额外联网。
- 项目未 out-of-sync 且 interval 未到时仍返回 `skipped/interval_not_elapsed`,不为了 release notes 联网。
- `git diff --check` 通过;相关 JS 文件可被 Node 加载或 CLI 场景验证通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后,运行 `task.py start`,随后进入 Phase 2.1 `trellis-route(implement)`。
