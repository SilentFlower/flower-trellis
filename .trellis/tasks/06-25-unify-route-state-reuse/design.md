# 统一路由状态复用机制设计

## Architecture

本任务将 route 语义拆成三个层次：

1. **个人默认偏好**：`.trellis/.route-prefs.tmp`，开发者本地、gitignored，表示“进入对应 target 后默认选哪种模式”。
2. **任务内 route 决策**：结构化 `route_decision`，表示“当前任务已经合法选择过某 target 的执行模式，可以复用”。
3. **执行动作**：主 agent 根据 route 决策执行 inline skill 或 subagent dispatch。

核心原则：执行动作只能来自合法 route 决策；合法 route 决策可以来自个人默认配置、`trellis-route` 交互、或编号 fallback，但不能来自自然语言摘要。

## Route Decision Contract

`trellis-route` 输出增加结构化块：

```yaml
route_decision:
  target: implement | check
  mode: inline | subagent | check-all-inline | check-all-subagent
  source: trellis-route | route-prefs | numbered-fallback
  scope: task
  task: <task path or current>
```

说明：

- `target=implement` 的 `mode` 使用 `inline` / `subagent`。
- `target=check` 的普通路径使用 `check-all-inline` / `check-all-subagent`。
- 轻量检查隐藏逃生口可使用 `check-inline` / `check-subagent` 或在 `mode` 中保留 `check`，但必须标注用户明确请求轻量检查。
- `source=route-prefs` 仅表示 `trellis-route` 读取到了有效偏好；不是 agent 自行读取空文件后的推断。

## Runtime State

本次优先采用“结构化 route_decision + 文案规则”的低侵入方案，不新增持久化脚本。原因：

- 当前平台没有统一的 route-state 写入点，强行新增脚本容易引入跨平台 context-id 清理问题。
- `trellis-route` 是 skill，无法直接调用写文件工具；让主 agent 再额外维护状态会加重流程。
- compact 问题的根因是缺少来源标记；结构化输出和摘要规则可以直接修复误判。

后续若要脚本化，可落到：

```text
.trellis/.runtime/route-state/<context-id>.json
```

`.trellis/.runtime/` 已被 `.trellis/.gitignore` 忽略，适合存放会话状态。

## Preflight

Phase 2.1 / 2.2 执行前统一判断：

1. 如果用户表达 route 覆盖意图，忽略已有 route 状态，进入 `trellis-route` 覆盖选项。
2. 如果当前任务存在 target 匹配、source 合法的 `route_decision`，直接复用。
3. 如果没有合法状态，调用 `trellis-route(target)`。
4. 如果 route helper / `request_user_input` 不可用，展示同编号 fallback 选项并等待用户选择。
5. 新 route 决策产生后，必须在回复或交接摘要中保留结构化 `route_decision`。

## Compact / SessionStart Rules

compact summary 与 SessionStart 只能转述两类信息：

- 合法：带 `route_decision` 结构和合法 `source` 的 route 状态。
- 非法：用户自然语言偏好，例如“用户说过 inline”，必须写成“偏好，不可作为有效 route 决策”。

这能修复 `019efe6f-6e70-7401-ae3d-31f9879d6bfd` 暴露的问题：summary 不能再把“用户选择过 inline”压缩成可执行路由。

## Files To Update

源文件：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`

生成/同步文件：

- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`
- `.trellis/workflow.md`
- `enhancements/0.6/**`
- `enhancements/MANIFEST.json`

## Trade-offs

- 只靠文案最小侵入，但仍依赖 agent 自律保留 `route_decision`。
- 增加 route-state 文件更可靠，但要维护跨平台 context-id、任务切换和清理策略。
- 本次选择结构化 contract，避免把流程从“问一次复用”变成“每步多维护一个文件”。

## Rollback

回退本任务时恢复 vendor skill-garden 0.6 源和生成快照即可。若后续出现 `.trellis/.runtime/route-state`，它是 gitignored 运行时文件，可直接删除。
