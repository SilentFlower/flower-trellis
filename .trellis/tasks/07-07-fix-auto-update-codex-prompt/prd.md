# 修正自动更新检查与 Codex 提示行为

## Goal

让 flower-trellis 的启动自更新提示在 Codex 和 Claude Code 中表现一致、可审计、不会误导用户:版本判断要能区分“远端确有新版”和“本地项目由不同版本铺设过需要重叠加”,`policy=ask` 时 AI 必须真正停下来询问用户确认,而不是只把确认要求当作普通背景文本。

## Background

用户在 Codex 会话中观察到 `<flower-update>` 注入后,AI 没有按 `ai_instruction: 先询问用户是否执行更新;用户确认后再运行推荐命令。` 立即询问,而是把它放进普通回答末尾。Claude Code 同类场景会询问。

用户补充:Codex 官方 `SessionStart` hook 支持 `matcher`,可用值包括 `startup` / `resume` / `clear` / `compact`;项目希望 Codex 的更新检查 hook 也像 Claude 一样限制到 `startup` 场景。

用户进一步询问:Codex Trellis 主上下文 hook `python3 -X utf8 .codex/hooks/session-start.py` 是否也能限制到 `startup`。决策为:主 Trellis 上下文 hook 不做 startup-only,而是显式覆盖 `startup|resume|clear|compact`;更新检查 hook `flower_update_hook.py` 只在 `startup` 跑,且 timeout 改为 30。

分支决策:本任务从 `main` 创建新分支 `beta-auto-update-codex-prompt` 实施,不直接在 `main` 上开发。

本次会话里的实际状态为:

- `current_flower=0.4.3`
- `project_flower=0.4.2`
- `bundled_trellis=0.6.5`
- `project_trellis=0.6.5`
- `remote.latest=0.4.2`
- `status=project_out_of_sync`
- `policy=ask`
- `safety_reasons=dirty_worktree`

这个状态容易造成语义混淆:本地当前工具版本 `0.4.3` 高于远端 latest `0.4.2`,但项目 manifest 记录仍是 `0.4.2`,于是当前逻辑仍推荐 `self-update --project-only`。用户明确决定:如果本轮本来需要联网查远端版本,就应先完成远端探测,再进行项目 manifest / `.trellis/.version` 与当前版本的判断。

最终优先级决策:如果远端版本高于当前本地 flower-trellis,即使项目同时 out-of-sync,也必须优先推荐完整 `self-update`,包含本地/全局 flower-trellis 包升级和项目内 Trellis / enhancement 重叠加;不得降级为 `--project-only`。

## Confirmed Facts

- `buildSelfCheck()` 先读取当前工具版本、捆绑 Trellis 版本、项目 `.trellis/.version` 和 manifest 的 `flowerVersion`,再构造基础 JSON。见 `src/lib/self-check.js:202`。
- 当前实现中,只要 `projectFlower !== currentFlower` 或 `projectTrellis !== currentTrellis`,就直接返回 `project_out_of_sync`,并且在此之前不会联网读取 npm dist-tags。见 `src/lib/self-check.js:253`。
- 远端探测只发生在本地版本一致性判断之后。见 `src/lib/self-check.js:300`。
- `policy=ask` 的机器可读结果目前只是 `ai.mode=ask` 与一段中文 instruction。见 `src/lib/self-check.js:150`。
- `flower_update_hook.py` 只把 `ai_instruction` 写进 `<flower-update>` 文本块,并通过 `hookSpecificOutput.additionalContext` 注入。见 `src/assets/flower_update_hook.py:77` 和 `src/assets/flower_update_hook.py:106`。
- Codex 当前把 `flower_update_hook.py` 注册为独立的 `SessionStart` hook group,但 group 没有 `matcher`。见 `.codex/hooks.json:14`。
- Codex 当前也把 Trellis 主上下文 hook `python3 -X utf8 .codex/hooks/session-start.py` 注册为独立的 `SessionStart` hook group,同样没有 `matcher`。见 `.codex/hooks.json:14`。
- `.codex/hooks/session-start.py` 注入的是 Trellis 主 SessionStart 上下文,包含 `<current-state>`、workflow 摘要、spec 索引、`<task-status>` 和 first-reply notice;这不是更新检查提示。见 `.codex/hooks/session-start.py:490`。
- `src/lib/codex-tweaks.js` 当前的 `ensureSessionStartCommand()` 只按命令去重并追加 group,不会设置或迁移 `matcher`。见 `src/lib/codex-tweaks.js:261`。
- Claude 已把 flower 更新检查 hook 合并到 `matcher: "startup"` 下,并清理 clear / compact 中的更新检查 hook。见 `src/lib/claude-tweaks.js:48`。
- Claude 的 Trellis 主上下文 hook 不是只跑 startup,而是注册在 startup / clear / compact 三类场景。见 `.claude/settings.json:6`。
- 本地规范当前写明“本地一致性检查先于远程节流”,且本地版本不一致时返回 `project_out_of_sync`。见 `.trellis/spec/flower-trellis/cli/config-and-state.md:165` 和 `.trellis/spec/flower-trellis/cli/config-and-state.md:194`。本任务如果改变该行为,需要同步更新规范。

## Requirements

- R1: `self-check --json` 的决策顺序必须调整为:在本轮需要联网探测远端版本时,先读取 npm dist-tags 并写入远端结果,再结合项目 manifest / `.trellis/.version` 判断最终状态与推荐动作。
- R2: `self-check --json` 必须明确区分两类证据:
  - 远端 dist-tag 表明当前安装的 flower-trellis 有新版可用,需要全局更新或完整 self-update。
  - 当前项目 manifest / `.trellis/.version` 与当前本地 CLI 状态不一致,需要项目重叠加或刷新 manifest。
- R3: 当远端 latest/beta 不高于当前本地 flower-trellis 版本时,不得把 `project_out_of_sync` 文案表现成“远端有更新”。推荐命令可以仍是项目级重叠加,但上下文必须说明这是本地项目状态刷新,不是 npm 新版升级。
- R4: 当远端 latest/beta 高于当前本地 flower-trellis 版本时,最终状态必须优先表达远端更新可用,推荐完整 `self-update`。如果项目也 out-of-sync,结果中仍需保留项目 out-of-sync 证据,但推荐命令不得使用 `--project-only`。
- R5: 远端探测失败时不得阻断会话启动;如果本地项目确实 out-of-sync,仍可提示项目刷新,但必须标注远端状态不可确认。
- R6: `policy=ask` 在 Codex 中必须被注入为更高优先级、更难忽略的操作要求:AI 必须先向用户提出明确确认问题,在用户确认前不得执行 `recommended_command`。
- R7: Codex 的 `flower_update_hook.py` 注册必须使用 `SessionStart` 的 `matcher: "startup"`,并迁移/避免旧的无 matcher 更新检查 group,使恢复、清空、压缩会话时不重复触发更新检查。
- R8: Codex 的 `flower_update_hook.py` hook timeout 必须改为 30,与主 SessionStart 上下文 hook 保持同等级启动预算。
- R9: Codex Trellis 主上下文 hook 的 `SessionStart` matcher 必须显式为 `startup|resume|clear|compact`,保留 resume / clear / compact 后重新注入完整 Trellis 上下文的能力,并迁移/避免旧的无 matcher 主上下文 group。
- R10: Claude Code 现有可用行为不得回退;Codex 修复不能引入 Codex SessionStart JSON schema 违规字段。
- R11: 启动 hook 仍只做只读检查与上下文注入,不得直接执行 `npm i -g`、`flower-trellis update` 或 `flower-trellis self-update`。
- R12: 如果实现改变现有 `project_out_of_sync` 的判断顺序、状态语义、hook 指令格式或 Codex matcher 策略,必须同步更新 `.trellis/spec/flower-trellis/cli/config-and-state.md` / `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的合同与验证矩阵。
- R13: 用户主动运行 `flower-trellis update` / `ftl update` 时,如果启动阶段已经成功联网取得 npm dist-tags,必须刷新已有项目 manifest 的 `updateCheck.lastRemote` / `lastCheckedAt` / `lastStatus`,避免主动更新后 SessionStart 仍使用旧远端缓存。
- R14: 主动 `init` / `update` 的 `checkForUpdate()` 必须尊重 manifest 中的 `updateCheck.enabled=false` / `policy=off`,与 `--no-update-check` 和 `FLOWER_NO_UPDATE_CHECK` 一起作为总开关;目标无 manifest 时不得为了写缓存创建半截 manifest。

## Acceptance Criteria

- [ ] 当 `current_flower=0.4.3`、`project_flower=0.4.2`、远端 `latest=0.4.2` 时,`self-check --json` 不把结果描述为“远端更新可用”;输出能清楚表达“项目由旧 flower 铺设过,建议项目重叠加/刷新”。
- [ ] 当远端 `latest` 高于当前本地版本时,`self-check --json` 仍返回真正的 `update_available`,并给出全局更新相关建议。
- [ ] 当 `projectFlower !== currentFlower` 且远端 `latest` 高于当前本地版本时,缓存过期路径不得提前返回 `project_out_of_sync`;必须先联网并优先给出完整 self-update 建议。
- [ ] 当远端 `latest` 高于当前本地版本且项目也 out-of-sync 时,推荐命令不带 `--project-only`,完整 self-update 会先更新本地/全局 flower-trellis 包,再执行项目内升级重叠加。
- [ ] 当本地项目 out-of-sync 且远端探测离线/失败时,结果稳定、不中断 hook,且上下文明确远端不可确认。
- [ ] Codex 收到 `policy=ask` 的 `<flower-update>` 后,注入内容包含必须停下询问的强约束;AI 在用户确认前不应运行 `recommended_command`。
- [ ] Codex 生成/合并后的 `.codex/hooks.json` 中,`flower_update_hook.py` 位于 `SessionStart` 的 `matcher: "startup"` group 下,timeout 为 30,且不会同时残留无 matcher 的 flower 更新检查 group。
- [ ] Codex 生成/合并后的 `.codex/hooks.json` 对 `python3 -X utf8 .codex/hooks/session-start.py` 使用 `matcher: "startup|resume|clear|compact"`,timeout 为 30,且不会同时残留无 matcher 的 Trellis 主上下文 group。
- [ ] `flower-trellis update --target <dir>` 主动探测成功后会刷新已有 manifest 的 `updateCheck.lastRemote`;随后全装 manifest 刷新仍保留这份最新缓存。
- [ ] `flower-trellis update --target <dir> --no-update-check` 或 manifest `policy=off` 时不联网、不写 `updateCheck` 缓存。
- [ ] `python3 -m py_compile src/assets/flower_update_hook.py` 通过。
- [ ] `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done` 通过。
- [ ] 使用假 `flower-trellis self-check --json` 驱动 `src/assets/flower_update_hook.py`,stdout 是合法 JSON,且顶层字段不包含 `additional_context`。
- [ ] `git diff --check` 通过。

## Remote Cache Decision

当远端缓存仍在 `intervalHours` 内时,可以使用缓存作为远端版本证据;当缓存过期或传入 `--force-remote` 时,必须先联网读取 npm dist-tags,再判断项目 manifest / `.trellis/.version` 与当前本地版本。项目本地版本不一致不得提前短路掉已经到期的远端探测。

## Additional Scenario

如果本地 flower-trellis 版本低、项目 manifest 版本也低,且远端版本更高:

- 若 `projectFlower === currentFlower`,当前实现会在缓存过期时联网,返回 `update_available`,推荐完整 `self-update`,随后全局升级并项目重叠加。
- 若 `projectFlower !== currentFlower`,当前实现会在联网前先返回 `project_out_of_sync`,推荐 `self-update --project-only`,因此会漏掉远端更高版本。这是本任务必须修复的核心场景之一。
