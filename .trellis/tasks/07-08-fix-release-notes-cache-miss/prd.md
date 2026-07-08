# 修复 flower-update release notes 缓存缺失

## Goal

修复 SessionStart `<flower-update>` 在项目版本追平场景中漏出 release notes 的问题。用户看到 `project_out_of_sync` 更新提示时,如果当前 flower 版本与项目 manifest 版本之间存在可用 npm metadata 摘要,提示块必须主动补拉并展示对应 `release_notes`,避免用户只能看到推荐命令却不知道本次更新内容。

## Background

- 用户复盘的故障链路成立:一次真实联网检查在 npm metadata 传播前写入了 `lastRemote` 和 `lastReleaseNotes: null`;后续 SessionStart 在 8 小时 interval 内命中远程缓存,没有重新联网,导致 `<flower-update>` 中没有 `release_notes`。
- 用户已明确产品意图:`project_out_of_sync` 是可执行更新提示,缓存里没有 release notes 时应主动调用 npm 远端取数据;只要 registry metadata 里存在目标版本摘要,本次提示就必须带出来。
- 规范要求 `self-check --json` 在 `update_available` 和 `project_out_of_sync` 中尽力输出 `releaseNotes` 摘要,其中 `project_out_of_sync` 范围为 `projectFlower < version <= currentFlower`。见 `.trellis/spec/flower-trellis/cli/config-and-state.md:167`、`.trellis/spec/flower-trellis/cli/config-and-state.md:169`。
- 规范允许缓存新鲜时复用 `lastRemote`,也允许复用匹配范围的 `lastReleaseNotes`,但必须校验 `range.from` / `range.to` / `range.channel`。见 `.trellis/spec/flower-trellis/cli/config-and-state.md:180`、`.trellis/spec/flower-trellis/cli/config-and-state.md:183`。
- 网络探测必须尽力而为:超时、离线、非 200 或字段异常不能阻断主流程。见 `.trellis/spec/flower-trellis/cli/config-and-state.md:67`。

## Confirmed Facts

- `src/lib/self-check.js:35` 的 `isRemoteCacheFresh()` 只依据 `lastRemote` / `lastCheckedAt` / 状态错误判断缓存新鲜度,不检查 `lastReleaseNotes` 是否满足当前输出需要。
- `src/lib/self-check.js:51` 的 `cachedReleaseNotes()` 在 `lastReleaseNotes` 为空、范围不匹配、`unavailable` 或版本列表为空时返回 `null`。
- `src/lib/self-check.js:405` 的缓存新鲜 + `projectOutOfSync` 分支直接把 `cachedReleaseNotes()` 的结果传给 `projectOutOfSyncResult()`;缓存里没有 notes 时不会发起补拉。
- `src/lib/self-check.js:421` 之后的真实联网分支已经能通过 `fetchPackageUpdateMetadata()` 和 `releaseNotesFromMetadata()` 构造并写入 `lastReleaseNotes`。
- `src/assets/flower_update_hook.py:92` 的 `_release_notes_lines()` 只在 `releaseNotes` 为 dict 时输出摘要或 `release_notes_unavailable`;当 self-check 返回 `releaseNotes: null` 时不会输出任何 release notes 相关字段。

## Requirements

- R1: 当 `self-check` 命中新鲜远程缓存,最终状态为 `project_out_of_sync`,且 `cachedReleaseNotes()` 对当前 `projectFlower -> currentFlower` 范围返回 `null` 时,必须绕过 interval 主动调用一次 npm registry metadata 来生成 release notes。
- R2: 补拉成功且 registry metadata 中存在目标范围摘要时,本次 `self-check` 结果必须包含非空 `releaseNotes.versions`,并在允许写缓存且 manifest 存在时写回 `updateCheck.lastReleaseNotes`;不得把 release notes 混入 `lastRemote`。
- R3: 补拉失败或 metadata 中没有可用摘要时,仍必须返回原有 `project_out_of_sync` 结果和推荐命令,并给本次结果返回带 range 的结构化 `releaseNotes.unavailable=true`;不得因为 release notes 缺失阻断 hook 或更新流程。
- R4: 补拉失败或摘要不可用不得刷新 `lastCheckedAt`,不得把远程缓存标记为刚确认,也不得覆盖已有可用 `lastReleaseNotes`。
- R5: 现有 `update_available` 缓存命中、`interval_not_elapsed`、离线降级和 `--force-remote` 行为不得回退。
- R6: 默认不修改 `flower_update_hook.py` 的字段格式;hook 继续只负责格式化 self-check 已提供的结构化 `releaseNotes`。

## Acceptance Criteria

- [ ] 构造“缓存新鲜 + `project_out_of_sync` + `lastReleaseNotes: null` + registry metadata 含目标版本 notes”的场景时,`self-check --json` 主动查询 npm metadata,返回 `project_out_of_sync` 且包含可展示的 `releaseNotes.versions`。
- [ ] 上述场景在 manifest 存在且允许写缓存时,会把可用摘要写入 `.trellis/.flower-manifest.json` 的 `updateCheck.lastReleaseNotes`,并保持 `lastRemote` 只包含 dist-tags。
- [ ] 构造补拉失败场景时,`self-check --json` 仍返回 `project_out_of_sync` 和原推荐命令,同时返回 `releaseNotes.unavailable=true`,不刷新 `lastCheckedAt`,不写 `lastStatus=offline` 覆盖新鲜缓存。
- [ ] 构造 registry metadata 缺少目标范围摘要的场景时,`self-check --json` 返回带当前 range 的 `releaseNotes.unavailable=true`,hook 可输出 `release_notes_unavailable: true`。
- [ ] 构造缓存已有匹配 release notes 的场景时,仍复用缓存摘要,不额外联网。
- [ ] 构造项目未 out-of-sync 且 interval 未到的场景时,仍返回 `skipped/interval_not_elapsed`,不为了 release notes 联网。
- [ ] 运行 `git diff --check` 通过;相关 JS 文件能被 Node 加载或对应 CLI 场景验证通过。

## Out of Scope

- 不改变 update check 的默认 `intervalHours: 8` 策略。
- 不改变 `<flower-update>` 的总体字段协议、Codex SessionStart JSON schema 或推荐命令格式。
- 不为普通 `interval_not_elapsed` 场景补拉 release notes,因为没有可执行更新提示需要展示。
