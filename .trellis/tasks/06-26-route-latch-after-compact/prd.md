# 压缩后复用本轮路由选择

## Goal

让 Trellis 在 Codex/Claude 对话压缩后，能够复用压缩前同一轮对话里已经通过合法 route 选择得到的 implement/check 执行模式，避免重复要求用户选择 `trellis-route`；同时不把 route 状态持久化到任务文件，也不放宽普通 compact summary 可伪装为 route 决策的安全边界。

## Background

此前任务 `06-25-unify-route-state-reuse` 已明确：普通用户自然语言、compact summary、SessionStart summary、`codex-mode`、空 `.route-prefs.tmp` 都不能单独构成有效 `route_decision`。这个规则修复了“压缩摘要把用户口头偏好误判为合法路由”的问题。

新的真实会话 `019f0264-3dc1-7000-926c-2749bdf8263b` 暴露了相反方向的体验问题：压缩前用户已经选择过 implement/check route，压缩摘要中虽然保留了“用户选择：implement 路由 inline，check 路由 inline check-all”，但由于它只是自然语言摘要，压缩后 agent 不能复用，只能重新询问 implement route。

本任务只解决“同一轮对话被压缩后，本轮已选过 route 不应重复问”的问题。route 仍然不是任务属性，也不是长期团队配置。

规划讨论更新：用户指出，与其要求压缩摘要保留额外 `route_latch` 块，更稳定的做法是在压缩后需要 route 复用时，通过 `trellis-session-insight` / `trellis mem` 回查同一历史会话中已经发生过的 route 选择。该方向优先级高于新增 `route_latch`。

进一步范围澄清：用户希望减少 token 指的是减少当前 skill-garden 注入到每轮上下文中的长内容块，而不是减少 `trellis mem` 查询本身的输出。实现应把低频细节下沉到 `trellis-route` skill，需要时再读；workflow hub / workflow-state 只保留短门禁和触发条件。

## Requirements

- 压缩后若当前上下文中没有可复用的 route 证据，但系统能识别这是同一项目/同一会话的压缩延续，应允许 agent 调用 `trellis-session-insight` / `trellis mem` 回查历史消息。
- 回查采用分级证据，不要求必须存在完整 `route_decision` 块：
  - 强证据：历史消息中存在结构化 `route_decision`，且 target/source/task 合理匹配。
  - 可接受证据：同一小段历史上下文中同时出现 route 选项、用户数字选择、assistant 输出的“路由决定：...”或等价结论，且能明确映射到 target/mode/source。
  - 不可接受证据：脱离 route 提问上下文的自然语言“用户喜欢 inline”、普通 compact summary、SessionStart 摘要、`codex-mode`、空 `.route-prefs.tmp`。
- 回查到的 route 状态必须能追溯到 `trellis-route`、编号 fallback 选择，或由 `trellis-route` 读取 `.route-prefs.tmp` 的有效配置；不能由 agent 自行偏好推断。
- 回查必须节省 token：优先用 `trellis mem search/context` 的 grep 和小窗口定位 `route_decision`、`路由决定`、`本次 implement`、`本次 check` 等关键词；不要默认 dump 整个会话。
- 减少高频注入 token：skill-garden workflow hub / workflow-state 中不应重复展开完整 route 来源、fallback、prefs、check-all、轻量 check 等细节；这些细节应集中保留在 `trellis-route` skill 内。
- 高频注入块只需表达：
  - Phase 2.1/2.2 前必须有 route 证据；
  - 有当前上下文 route 决策则复用；
  - 压缩后缺失 route 证据时，先用 `trellis-session-insight` 回查历史 route 选择；
  - 证据不明确、需要历史回查或需要展示选项时，必须读取/调用 `trellis-route`，不能只凭 workflow 短门禁自行解释细则；
  - 用户显式覆盖时重新 route；
  - 无证据再调用 `trellis-route`。
- 不要求新增 `route_latch`；如后续仍保留该概念，只能作为可选别名或辅助，不作为主方案。
- 普通 compact summary、SessionStart summary、自然语言“用户选过 inline”、用户口头偏好、`codex-mode` 仍不能单独作为 route 决策。
- 该机制只解决压缩后的同轮复用，不写入 `.trellis/tasks/<task>/task.json` / `prd.md` / `brief.md`，不把 route 变成任务属性。
- 本任务不新增长期持久化文件；若实现需要临时运行时状态，必须位于 gitignored 路径，并且不能成为用户链路中的新步骤。
- 用户明确要求“重选 / 临时改 / 这次用 X / 清除默认 / route 重新选择”时，必须忽略历史回查结果并重新进入 route。
- 现有 `.trellis/.route-prefs.tmp` 个人默认语义保持不变；历史回查不替代个人默认，也不是开工授权。
- 更新相关 Trellis 文案时，需要同步源头与当前 dogfood 副本，避免 `.agents`、`.claude`、`.trellis/workflow.md`、skill-garden/enhancements 快照语义漂移。

## Acceptance Criteria

- [ ] `trellis-route` / workflow 规则明确：压缩后可通过 `trellis-session-insight` / `trellis mem` 小范围回查历史 route 选择证据，命中可接受证据时复用，不再重复询问。
- [ ] 回查规则定义强证据与可接受证据；普通 compact summary、自然语言“用户选过 inline”、SessionStart 摘要仍不能单独构成证据。
- [ ] 用户显式覆盖时必须忽略历史回查结果并重新 route。
- [ ] 文案明确该机制是同会话历史回查，不把 route 写成任务属性或长期配置。
- [ ] skill-garden workflow hub / workflow-state 注入文案更短，路由细则下沉到 `trellis-route` skill，避免每轮重复注入长规则。
- [ ] workflow hub / workflow-state 明确要求在证据不明确、压缩恢复或需要选项时加载 `trellis-route`；不能让 agent 在未读 skill 的情况下自行判断详细规则。
- [ ] `.agents`、`.claude`、`.trellis/workflow.md`、skill-garden/enhancements 相关副本语义一致。
- [ ] 通过搜索确认不存在“任意 compact summary 可作为 route 决策”的表述。
- [ ] 通过静态检查确认 Markdown/模板变更无明显格式问题，且 `git diff --check` 通过。

## Notes

- 本任务偏文案/契约优化，预计可 PRD-only；若实现过程中发现需要新增 hook/script 或持久化机制，再补 `design.md` 与 `implement.md`。
- 用户已选择推荐边界：先只改 `trellis-route` / workflow 文案契约，不改 SessionStart/压缩 hook，不做主动提取或注入。
- 后续讨论将主方案调整为历史回查：压缩后通过 `trellis-session-insight` / `trellis mem` 找回历史 route 选择证据，而不是要求压缩摘要额外保留 `route_latch`。
