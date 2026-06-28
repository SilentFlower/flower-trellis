# 压缩后复用本轮路由选择

## Goal

让 Trellis 在 Codex/Claude 对话压缩后，能够复用压缩前同一轮对话里已经通过合法 route 选择得到的 implement/check 执行模式，避免重复要求用户选择 `trellis-route`；同时不把 route 状态持久化到任务文件，也不放宽普通 compact summary 可伪装为 route 决策的安全边界。

## Background

此前任务 `06-25-unify-route-state-reuse` 已明确：普通用户自然语言、compact summary、SessionStart summary、`codex-mode`、空 `.route-prefs.tmp` 都不能单独构成有效 `route_decision`。这个规则修复了“压缩摘要把用户口头偏好误判为合法路由”的问题。

新的真实会话 `019f0264-3dc1-7000-926c-2749bdf8263b` 暴露了相反方向的体验问题：压缩前用户已经选择过 implement/check route，压缩摘要中虽然保留了“用户选择：implement 路由 inline，check 路由 inline check-all”，但由于它只是自然语言摘要，压缩后 agent 不能复用，只能重新询问 implement route。

本任务只解决“同一轮对话被压缩后，本轮已选过 route 不应重复问”的问题。route 仍然不是任务属性，也不是长期团队配置。

规划讨论更新：原本考虑通过 `trellis-session-insight` / `trellis mem` 回查同一历史会话中已经发生过的 route 选择，但真实 SRM Codex session 复原发现：原始 JSONL 内有完整 `route_decision`，`trellis mem` 在 compact 后的 cleaned dialogue 却可能只保留 replacement history，导致查不到压缩前 assistant route 消息。用户最终确认改为 runtime 持久化方案。

最终方案：`trellis-route` 通过随 skill 分发的 `scripts/route_state.py` 解析和写入路由状态。常规入口只调用一次 `resolve --target <implement|check>`：helper 先读取 gitignored 的 `.trellis/.runtime/sessions/<context-key>.json` 中的 `route_decisions` 字段；未命中时再读取 `.trellis/.route-prefs.tmp`；prefs 命中时自动写回当前 session runtime。该状态是 session/window scoped runtime state，不进入任务文件，不进入 git，不作为长期配置。

进一步范围澄清：用户希望减少 token 指的是减少当前 skill-garden 注入到每轮上下文中的长内容块。实现应把 runtime state / prefs 解析写入下沉到 helper 脚本，把 fallback、check-all、轻量 check 等低频细节集中保留在 `trellis-route` skill，需要时再读；workflow hub / workflow-state 只保留短门禁和触发条件。

## Requirements

- `trellis-route` 常规无覆盖路径必须只调用一次 helper：`route_state.py resolve --target <implement|check>`。
- helper 必须优先读取 `.trellis/.runtime/sessions/<context-key>.json` 的 `route_decisions.<target>`；未命中时读取 `.trellis/.route-prefs.tmp`；prefs 命中时自动写回 session runtime。
- 用户编号选择新模式后，必须通过 helper 写入当前 session runtime；保存/更新默认时通过同一次 helper 调用加 `--save-pref` 写入 `.route-prefs.tmp`。
- 清除默认必须通过 helper 只清当前 target 的 `.route-prefs.tmp` 项；不直接编辑 prefs 文本。
- `<context-key>` 应复用 Trellis active-task session context key，例如 `task.py current --source` 输出的 `session:codex_...` 或唯一 `session-fallback:...`。
- runtime state 必须是 gitignored session/window scoped state，不得写入 `.trellis/tasks/<task>/task.json` / `prd.md` / `brief.md`。
- runtime state 只能保存原始合法来源：`trellis-route`、`numbered-fallback`、`route-prefs`；不能把 `.runtime` 自身变成新的 `route_decision.source`。
- 压缩后若当前上下文没有可复用的 route 证据，`trellis-route` 应调用 helper resolve；命中当前 task/target/source/mode 后复用，不需要 `trellis mem`。
- runtime state 命中条件必须严格：
  - context key 属于当前 session 或唯一 session fallback；
  - session runtime 的 `current_task` 与当前任务一致；
  - target 与本次 route 目标一致；
  - source 是合法原始来源；
  - mode 对该 target 合法；
  - scope 为 task。
- runtime state 文件缺失、JSON 损坏、task/target/source/mode 不匹配时，忽略并继续读取 `.route-prefs.tmp` 或展示选项；不要删除不匹配文件，避免误伤其他窗口。
- 减少高频注入 token：skill-garden workflow hub / workflow-state 中不应重复展开完整 route 来源、fallback、prefs、check-all、轻量 check 等细节；这些细节应集中保留在 `trellis-route` skill 内。
- 高频注入块只需表达：
  - Phase 2.1/2.2 前必须有 route 证据；
  - 有当前上下文 route 决策则复用；
  - 没有当前上下文 route 决策时，必须读取/调用 `trellis-route`，由它验证 runtime state、prefs 或展示选项；
  - workflow/state 不能只凭短门禁自行解释 runtime state 细则；
  - 用户显式覆盖时重新 route；
  - 无证据再调用 `trellis-route`。
- 不新增 `route_latch`。
- 普通 compact summary、SessionStart summary、自然语言“用户选过 inline”、用户口头偏好、`codex-mode` 仍不能单独作为 route 决策。
- 该机制只解决压缩后的同轮复用，不把 route 变成任务属性。
- 临时运行时状态必须位于 gitignored 路径，并且不能成为用户链路中的新步骤。
- 用户明确要求“重选 / 临时改 / 这次用 X / 清除默认 / route 重新选择”时，必须忽略历史回查结果并重新进入 route。
- 现有 `.trellis/.route-prefs.tmp` 个人默认语义保持不变，但读写由 helper 统一处理；runtime state 优先级高于个人默认，因为它表示本轮已经选择过；两者都不是开工授权。
- 更新相关 Trellis 文案时，需要同步源头与当前 dogfood 副本，避免 `.agents`、`.claude`、`.trellis/workflow.md`、skill-garden/enhancements 快照语义漂移。

## Acceptance Criteria

- [ ] `trellis-route` / workflow 规则明确：route 决策写入 `.trellis/.runtime/sessions/<context-key>.json` 的 `route_decisions` 字段，压缩后由 `trellis-route` helper 验证并复用，不再重复询问。
- [ ] 常规无覆盖路径只需一次 `route_state.py resolve`；helper 能先读 session runtime，再读 prefs，prefs 命中时自动写回 session runtime。
- [ ] runtime state 规则定义 context key、task、target、source、mode、scope 的严格命中条件；普通 compact summary、自然语言“用户选过 inline”、SessionStart 摘要仍不能单独构成证据。
- [ ] 用户显式覆盖时必须忽略历史回查结果并重新 route。
- [ ] 文案明确该机制是 session/window runtime state，不把 route 写成任务属性或长期配置。
- [ ] skill-garden workflow hub / workflow-state 注入文案更短，路由细则下沉到 `trellis-route` skill，避免每轮重复注入长规则。
- [ ] workflow hub / workflow-state 明确要求在证据不明确、需要 runtime state、prefs 或选项时加载 `trellis-route`；不能让 agent 在未读 skill 的情况下自行判断详细规则。
- [ ] `.agents`、`.claude`、`.trellis/workflow.md`、skill-garden/enhancements 相关副本语义一致。
- [ ] 通过搜索确认不存在“任意 compact summary 可作为 route 决策”的表述。
- [ ] 通过静态检查确认 Markdown/模板变更无明显格式问题，且 `git diff --check` 通过。

## Notes

- 本任务偏文案/契约优化，预计可 PRD-only；若实现过程中发现需要新增 hook/script 或持久化机制，再补 `design.md` 与 `implement.md`。
- 用户最终选择 runtime 持久化边界：不改 SessionStart/压缩 hook，不做任务级持久化，不依赖 `trellis mem`，用 `.trellis/.runtime/sessions/<context-key>.json` 的 `route_decisions` 字段保存本轮 route 执行状态，并由 helper 统一处理 runtime + prefs。
