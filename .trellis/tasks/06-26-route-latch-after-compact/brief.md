# Brief — 压缩后复用本轮路由选择

## Goal

- 让 Trellis 在 Codex/Claude 对话压缩后，能通过历史回查复用压缩前同一轮对话里已经发生过的 implement/check route 选择，避免重复询问，同时保持 route 不是任务属性、不是长期配置。

## Scope

- 更新 `trellis-route` / workflow 相关文案契约。
- 压缩后缺少当前上下文 route 证据时，允许通过 `trellis-session-insight` / `trellis mem` 小范围回查历史 route 选择。
- 将 route 证据规则定义为分级证据：结构化 `route_decision` 为强证据；同一小段上下文中 route 选项、用户数字选择、assistant 路由结论能明确对应时为可接受证据。
- 缩短 skill-garden 高频 workflow hub / workflow-state 注入内容，把 route 细则下沉到 `trellis-route` skill。
- 高频门禁必须确保 agent 在证据不明确、压缩恢复或需要选项时读取/调用 `trellis-route`，不能只凭短摘要自行判断细则。
- 同步源头和当前 dogfood 副本，避免 `.agents`、`.claude`、`.trellis/workflow.md`、skill-garden/enhancements 语义漂移。

## Non-Goals

- 不新增 `route_latch` 作为主方案。
- 不修改 SessionStart/压缩 hook，不做主动提取或注入。
- 不把 route 状态写入 `.trellis/tasks/<task>/task.json`、`prd.md` 或 `brief.md`。
- 不新增长期持久化文件。
- 不改变 `.trellis/.route-prefs.tmp` 的个人默认偏好语义。
- 不允许普通 compact summary、SessionStart summary、自然语言“用户选过 inline”、`codex-mode` 单独构成 route 决策。

## Key Context

- 相关既有任务：`06-25-unify-route-state-reuse` 曾修复 compact summary 误判为 route 决策的问题。
- 新问题来自会话 `019f0264-3dc1-7000-926c-2749bdf8263b`：压缩前已选择 route，压缩后因只有自然语言摘要而重复询问 implement route。
- 主要修改点预计包含 `trellis-route` skill、skill-garden workflow hub / workflow-state，以及对应 `.agents`、`.claude`、`.trellis/workflow.md`、`enhancements/0.6` 副本。
- 关键约束：减少高频注入 token；低频细节只在进入 route 边界时由 `trellis-route` 承载。

## Acceptance

- `trellis-route` / workflow 规则明确：压缩后可通过 `trellis-session-insight` / `trellis mem` 小范围回查历史 route 选择证据。
- 回查规则定义强证据与可接受证据；普通 compact summary、自然语言“用户选过 inline”、SessionStart 摘要仍不能单独构成证据。
- 用户显式覆盖时必须忽略历史回查结果并重新 route。
- 高频注入文案更短，route 细则下沉到 `trellis-route` skill。
- 证据不明确、压缩恢复或需要选项时必须加载 `trellis-route`。
- 相关副本语义一致。
- 搜索确认不存在“任意 compact summary 可作为 route 决策”的表述。
- 静态检查通过，至少包括 Markdown/模板格式复核和 `git diff --check`。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `task.py start` 进入 `in_progress`，随后按 Phase 2.1 执行 `trellis-route(implement)`。
