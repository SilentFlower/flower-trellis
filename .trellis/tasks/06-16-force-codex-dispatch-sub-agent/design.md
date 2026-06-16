# 强制 Codex dispatch_mode 为 sub-agent 设计

## Scope

本任务覆盖两条互补路径:

1. flower-trellis 在 `init` / `update` 叠加强化包时,对 Codex 目标强制写入 `.trellis/config.yaml` 的 `codex.dispatch_mode: sub-agent`。
2. 加强 `trellis-route` skill 文案,明确 Codex inline 注入不是 route 选项裁剪器,避免模型在旧项目或临时 inline 场景中自行推断“只能 inline”。
3. 小幅调整 `in_progress-inline` workflow-state,让它与 route skill 语义一致:默认 inline,但紧邻 route 选择 subagent 时允许本步 dispatch。

## Architecture

`src/lib/apply-enhancements.js` 是 init / update 的共同叠加入口。它在复制技能、注入 workflow 后调用 `applyCodexTweaks(target)`。因此配置强制逻辑应收敛到 `src/lib/codex-tweaks.js`,让 init / update 自动共享。

当前 `applyCodexTweaks()` 已经以 `.codex/` 是否存在作为 Codex 平台判断。新增逻辑继续沿用该边界:

- `.codex/` 不存在:返回 `{ applied: false }`,不改 `.trellis/config.yaml`。
- `.codex/` 存在:清理 `.codex/config.toml`、合并 hooks、确保 `.trellis/config.yaml` 的 `codex.dispatch_mode` 为 `sub-agent`。

## Config Update Strategy

目标是幂等和低破坏。实现可以采用行级 YAML 小范围编辑,因为本项目已有 `.trellis/scripts/common/trellis_config.py` 也是小子集解析,且只需要处理一个顶层 mapping。

建议逻辑:

1. 读取 `.trellis/config.yaml`;缺失时视为空文本。
2. 定位未注释的顶层 `codex:` 块。
3. 如果存在该块:
   - 在块内查找未注释的 `dispatch_mode:`。
   - 有则替换为同缩进 `dispatch_mode: sub-agent`。
   - 无则在 `codex:` 后插入 `  dispatch_mode: sub-agent`。
4. 如果不存在该块:
   - 在文件末尾追加独立的 Codex 配置块。
5. 内容无变化则不写盘。

注释示例不视为有效配置。这样可以从当前上游默认注释示例平滑变为真实配置。

## Route Skill Strengthening

`trellis-route` skill 需要加入 Codex inline 的语义澄清:

- `codex.dispatch_mode=inline` 或 `<codex-mode>` inline 是默认执行偏好,不是 route 选项过滤器。
- 不得据此推断 “只能 inline implement/check-all”。
- route 仍必须读取 `.trellis/.route-prefs.tmp`;无有效偏好时仍展示正常 inline/subagent 选项。
- 一旦 route 明确选择 subagent,该“紧邻路由决定”就是本步骤 dispatch subagent 的许可;仍不得绕过 route 直接 spawn。

需要同步的副本:

- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`

然后运行 `npm run sync` 更新发布快照 `enhancements/0.6/...`。

## Workflow-State Alignment

`in_progress-inline` 当前同时要求 route implement/check,又写着“Only after the route selects inline...”和“Do not dispatch...”。这会和加强后的 route skill 继续冲突。

调整方向:

- 保留“inline mode does not skip `trellis-route`”。
- 改为“默认 flow 是 inline;如果紧邻 `trellis-route` 选择 subagent,本步骤允许 dispatch”。
- 不让 main session 绕过 route 直接 spawn subagent。

需要同步的副本:

- `.trellis/workflow.md` 的 `[workflow-state:in_progress-inline]`
- `enhancements/0.6/overrides/workflow-states/in_progress-inline.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`

## Compatibility

- 对非 Codex 项目不写 `codex` 配置,避免污染 Claude-only / Gemini-only 目标。
- 对已有 `codex` 其它配置键保持原样。
- 对已有 `dispatch_mode: inline` 明确覆盖为 `sub-agent`,这是本任务的产品决策。
- 不修改 `<codex-mode>` hook 本身;新项目通过配置让 hook 输出 sub-agent 分支,旧项目通过 route skill + workflow-state 补强降低误判。

## Rollback

- 回退 `src/lib/codex-tweaks.js` 与 `src/lib/apply-enhancements.js` 的输出调整。
- 回退 trellis-route skill 文案及由 `npm run sync` 生成的 enhancements 快照。
- 已被目标项目写入的 `.trellis/config.yaml` 可手动改回 `codex.dispatch_mode: inline`。
