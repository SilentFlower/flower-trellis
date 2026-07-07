# 修正自动更新检查与 Codex 提示行为 - Design

## Architecture

本任务涉及三条边界:

- `src/lib/self-check.js`: 启动自更新检查的状态机,负责版本读取、远端缓存/联网探测、推荐命令、安全状态和 AI 动作建议。
- `src/assets/flower_update_hook.py`: 将 `self-check --json` 的结构化结果转换为 Codex / Claude Code `SessionStart` additionalContext。
- `src/lib/codex-tweaks.js`: 在 `init` / `update` 后处理阶段合并 `.codex/hooks.json`,负责 Codex SessionStart matcher / timeout 的幂等迁移。

规范同步范围:

- `.trellis/spec/flower-trellis/cli/config-and-state.md`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`

## Self-Check State Flow

`buildSelfCheck()` 仍先读取本地只读信息,但不再用项目版本不一致提前短路远端判断。

目标流程:

1. 检查目标是否是 Trellis 项目、更新检查是否关闭、是否 npx 临时运行。
2. 计算 `projectOutOfSync` 和原因,写入结果结构,但不立即返回。
3. 判断远端证据来源:
   - `forceRemote=true` 或缓存过期: 先联网 `fetchPackageDistTags()`。
   - 缓存新鲜: 使用 `updateCheck.lastRemote`。
4. 根据远端 tags 对当前本地 flower-trellis 版本生成 `recommendation`。
5. 若存在远端升级推荐,返回 `update_available`,推荐完整 `self-update --target <dir> --yes`,同时保留 `projectOutOfSync` 证据。
6. 若无远端升级推荐但 `projectOutOfSync=true`,返回 `project_out_of_sync`,推荐 `self-update --project-only`。
7. 若远端探测失败且 `projectOutOfSync=true`,返回 `project_out_of_sync`,但标注 remote error / unavailable,避免误称远端已确认无更新。
8. 其它路径保持 `up_to_date`、`skipped/interval_not_elapsed`、`offline` 等既有语义。

## Active Update Cache Refresh

`src/lib/update-check.js` 的 `checkForUpdate()` 在 `init` / `update` 启动阶段本来就会联网
取得 npm dist-tags。该结果不能只用于即时提示,还应作为下一次 SessionStart 的远程证据:

- 成功取得 dist-tags 后,若目标已有 `.trellis/.flower-manifest.json`,用 `writeUpdateCheck()`
  写入 `lastCheckedAt`、`lastRemote`、`lastStatus` 和 `lastErrorCode=null`。
- 写入是尽力而为优化,失败不阻断 `init` / `update`。
- 目标还没有 manifest 时跳过,避免在 `init` 前创建只有 `updateCheck` 的半截 manifest。
- `checkForUpdate()` 除了 `--no-update-check` / `FLOWER_NO_UPDATE_CHECK`,也要尊重 manifest
  中的 `updateCheck.enabled=false` / `policy=off`。

## Result Shape

保持现有字段兼容,新增项目状态细节:

- `project.outOfSync: boolean`
- `project.outOfSyncReasons: string[]`

建议原因值:

- `flower_version_mismatch`
- `trellis_version_mismatch`

`update_available` 且 `project.outOfSync=true` 时:

- `commands.recommended` 使用完整 `selfUpdateCommand(target)`。
- `commands.projectUpdate` 可保留为辅助命令。
- `commands.npm` 保留远端升级命令。
- `ai.command` 指向完整 self-update。

`project_out_of_sync` 时:

- `commands.recommended` 使用 `selfUpdateCommand(target, { projectOnly: true })`。
- `reason` 使用本地项目刷新语义,例如 `local_version_mismatch`。

## Hook Context

`flower_update_hook.py` 需要让 `policy=ask` 更像阻塞操作要求:

- 保留 `<flower-update>` 块,不增加 Codex 不接受的顶层 JSON 字段。
- 增加机器易读字段,例如 `ai_mode: ask`。
- 对 `ask` 输出强约束文本,明确“必须先询问用户;确认前禁止执行推荐命令”。
- 对 `project.outOfSync` 输出项目刷新证据,便于 AI 解释“远端更新”和“项目重叠加”的差异。

## Codex Hooks Merge

`codex-tweaks.js` 需要从“只追加缺失命令”升级为“按命令归位到目标 matcher group”:

- Trellis 主上下文 hook:
  - `matcher: "startup|resume|clear|compact"`
  - `timeout: 30`
- Flower 更新检查 hook:
  - `matcher: "startup"`
  - `timeout: 30`

迁移规则:

1. 遍历 `config.hooks.SessionStart`。
2. 从所有 group 中移除目标命令的旧 hook,包括无 matcher 或错误 matcher group。
3. 确保目标 matcher group 存在。
4. 向目标 group 添加目标 hook。
5. 保留其它非目标自定义 hook 和其它 group。
6. 不强制删除空 group,除非该 group 因迁移目标 hook 后完全为空且没有 matcher 意义;优先保守。

## Compatibility

- 不修改 hook 输出 JSON 顶层结构;Codex 仍只读 `hookSpecificOutput.additionalContext`。
- 不改变 Claude Code settings 合并策略。
- 不让启动 hook 执行写入型更新命令。
- 保留 `project_out_of_sync` 状态,避免破坏外部对状态名的依赖。

## Rollback

若行为异常,可回滚本任务修改的文件:

- `src/lib/self-check.js`
- `src/assets/flower_update_hook.py`
- `src/lib/codex-tweaks.js`
- `.trellis/spec/flower-trellis/cli/config-and-state.md`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`
- 当前任务规划文件
