# 优化自动更新变更说明与推送联动 - Design

## Architecture

本任务横跨六条边界:

- 发布链路:从 `CHANGELOG.md` 抽取当前版本段,写入 npm package metadata。
- registry 读取:`src/lib/update-check.js` 一次读取 npm 根文档,同时得到 dist-tags 和版本 notes metadata。
- self-check 状态机:`src/lib/self-check.js` 根据远端更新或项目 out-of-sync 计算 release notes 摘要。
- manifest 缓存:`src/lib/manifest.js` 保留远端版本事实,并缓存上次生成的 release notes 摘要。
- hook 注入:`src/assets/flower_update_hook.py` 把摘要写入 `<flower-update>`,让 AI 在询问确认时展示更新内容。
- 更新后联动:`src/commands/self-update.js` 在真实写入后输出 `<flower-update-result>`,提示 AI 进入 `trellis-push` 确认流程。

workflow override 只增加轻量兜底提醒,源文件在 `vendor/skill-garden/.trellis/0.6/overrides/`,再通过 `npm run sync` 同步到 `enhancements/0.6` 和当前 dogfood 副本。

## npm Metadata Contract

在 `package.json` 增加 flower 内部字段:

```json
{
  "flowerReleaseNotes": {
    "version": "0.4.6",
    "source": "CHANGELOG.md",
    "body": "本版本 CHANGELOG 段落",
    "truncated": false
  }
}
```

约束:

- 字段是内部 metadata,不作为 README 公共 API。
- `version` 必须等于当前 `package.json.version`;不一致时读取方忽略。
- `body` 来自 `CHANGELOG.md` 对应版本段。
- 生成脚本应设置 metadata 写入上限,避免异常 CHANGELOG 段把 `package.json` 撑大;注入层另有更严格摘要上限。
- 每个版本只保存当前版本 notes,不重复保存 recent map。

发布流程:

1. `commit-and-tag-version` bump `package.json.version`。
2. `commit-and-tag-version` 生成 `CHANGELOG.md`。
3. `postchangelog` 运行 `scripts/write-release-notes-metadata.mjs`,抽取当前版本段并写入 `package.json.flowerReleaseNotes`。
4. release commit 提交 `package.json`、`package-lock.json`、`CHANGELOG.md`。
5. CI `npm publish` 后,该字段进入 npm registry 对应版本 metadata。

## Registry Fetch Contract

保留兼容导出:

- `fetchPackageDistTags()` 继续返回 `{latest,beta}` 或 `null`。
- 新增或扩展内部读取函数,一次请求 registry 根文档后解析:
  - `distTags`
  - `releaseNotesByVersion`

建议结构:

```js
{
  tags: { latest: "0.4.6", beta: "0.4.7-beta.0" },
  releaseNotesByVersion: {
    "0.4.6": {
      version: "0.4.6",
      body: "...",
      truncated: false,
      source: "npm"
    }
  }
}
```

失败策略:

- registry 请求失败仍返回 `null`,不阻断 init / update / hook。
- notes 字段缺失或损坏只影响 notes 摘要,不得影响版本更新判断。
- `lastStatus=offline` / `lastErrorCode` 的语义保持不变。

## Release Notes Summary

`self-check` 输出新增 `releaseNotes`:

```json
{
  "source": "npm-metadata",
  "range": {
    "from": "0.4.4",
    "to": "0.4.6",
    "channel": "latest",
    "reason": "update_available"
  },
  "versions": [
    { "version": "0.4.5", "body": "...", "truncated": false }
  ],
  "truncated": false,
  "moreVersions": false,
  "unavailable": false
}
```

范围规则:

- `update_available`: `from=currentFlower`, `to=recommendation.version`, `channel=recommendation.tag`。
- `project_out_of_sync`: `from=projectFlower`, `to=currentFlower`, `channel` 按当前本地 flower 版本形态推断。
- beta 用户升级回 stable latest:以 stable 目标 notes 为主,可标记通道切换,不重复展示 beta 历史。

过滤规则:

- stable 目标只聚合稳定版本 notes。
- beta 目标只聚合 beta 通道 notes。
- 版本比较沿用 `compareVersions()`。
- 候选超过 5 个版本时保留最新 5 个并设置 `moreVersions=true`。
- 单版本 body 最多 500 字符,总摘要最多 1600 字符。
- 被截断时设置 `truncated=true`。

缓存策略:

- `updateCheck.lastRemote` 继续只保存 dist-tags。
- 新增 `updateCheck.lastReleaseNotes` 保存最近一次可用摘要。
- 远端探测成功时可写入 notes 缓存;远端探测失败不刷新 `lastCheckedAt`,也不覆盖已有可用 notes。
- 旧 manifest 缺失 `lastReleaseNotes` 时归一化为 `null`。

## Hook Context

`flower_update_hook.py` 在 `<flower-update>` 中新增:

```text
release_notes: [{"version":"0.4.6","body":"..."}]
release_notes_range: 0.4.4 -> 0.4.6
release_notes_truncated: false
release_notes_more_versions: false
```

`policy=ask` 时保持现有阻塞确认字段,并在 `ai_required_action` 中强调先向用户展示更新摘要和推荐命令,再询问确认。

## Self-Update Result

真实写入完成后输出:

```text
<flower-update-result>
status: completed
target: /path/to/project
write: true
git_dirty_count: 3
changed_files_detected: true
post_action: run_trellis_push_confirmation
ai_instruction: 汇总本次升级产生的文件变动,进入 trellis-push 执行计划并等待用户确认。
</flower-update-result>
```

`--dry-run` 输出预览:

```text
<flower-update-result>
status: dry_run
write: false
post_action_preview: run_trellis_push_after_real_update
</flower-update-result>
```

`self-update` 不执行任何 git add / commit / push。`trellis-push` 仍是唯一提交/推送边界。

## Workflow Override

在 0.6 workflow hub 增加短段落,语义:

- 若当前上下文包含 `<flower-update>` 且 `priority=blocking_confirmation_required`,第一回复必须优先处理 flower 更新确认。
- 如果存在 `release_notes`,先用短句展示更新内容。
- 用户确认前不得执行 `recommended_command`。
- 若后续命令输出 `<flower-update-result>` 且要求 `run_trellis_push_confirmation`,进入 `trellis-push` 计划,仍需用户确认文件列表和 commit message。

该段放在 hub 中,不复制大量 hook 字段说明到 workflow-state。

## Compatibility

- 旧 npm 版本没有 `flowerReleaseNotes`:正常降级为无摘要。
- 旧 manifest 没有 `lastReleaseNotes`:正常归一化。
- release notes 获取失败不影响版本更新提示。
- Codex SessionStart JSON 顶层结构不变,仍只使用 `hookSpecificOutput.additionalContext`。

## Rollback

- 回滚代码文件:`src/lib/update-check.js`、`src/lib/self-check.js`、`src/lib/manifest.js`、`src/assets/flower_update_hook.py`、`src/commands/self-update.js`。
- 回滚发布链路:`scripts/write-release-notes-metadata.mjs`、`scripts/extract-changelog.mjs` 的共享抽取改动、`package.json` 的 `commit-and-tag-version.scripts` 配置。
- 回滚 workflow override:还原 `vendor/skill-garden/.trellis/0.6/overrides/` 后重新 `npm run sync`。
