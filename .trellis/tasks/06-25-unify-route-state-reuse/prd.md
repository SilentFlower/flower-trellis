# 统一路由状态复用机制

## Goal

统一 Trellis Phase 2.1 implement 与 Phase 2.2 check 的路由状态语义：已通过合法路由选择过的执行模式应在当前任务后续实现、修复、重检中默认复用；但普通对话、压缩摘要、`codex-mode` 或空配置不能伪装成合法路由决策。

## Background

近期提交 `d0749e1 fix(route): refine check repair loop routing` 已强化“check 失败后的同轮修复/重检复用最近路由”规则，但实际会话 `019efe6f-6e70-7401-ae3d-31f9879d6bfd` 暴露出另一个问题：用户自然语言说过“我选 inline”后，compact summary 将其压缩为“用户选择过 inline / 走 inline check-all”，后续 agent 将其误判为有效 `trellis-route` 决策，绕过了 Phase 2.2 路由门禁。

需要把“复用已选模式”和“验证来源合法”合并为一个机制，而不是继续依赖自然语言摘要。

## Requirements

- Route 决策必须有结构化来源，合法来源仅包括：
  - `trellis-route` skill 输出；
  - `trellis-route` helper 不可用时，同编号 fallback 选项的用户选择；
  - `trellis-route` 读取到的 `.trellis/.route-prefs.tmp` 有效配置。
- 当前任务内已存在 target 匹配且来源合法的 route 决策时，后续 Phase 2.1 implement 与 Phase 2.2 check 默认复用该模式。
- 用户明确说“重选 / 临时改 / 这次用 X / 清除默认 / route override”等覆盖意图时，必须重新进入 `trellis-route` 或同编号 fallback，且覆盖结果更新 route 状态。
- 普通用户消息如“我选 inline”、compact summary、SessionStart 摘要、`codex-mode inline/sub-agent`、空 `.route-prefs.tmp`、旧单值偏好，都不能单独构成有效 route 决策。
- check 普通路径仍默认 `check-all inline/subagent`，轻量 `trellis-check` 仍只在用户明确请求 `light check` / `轻量检查` 时进入隐藏逃生口。
- 新机制应适配当前 Codex sub-agent 模式、inline 模式、Claude / `.agents` 两套 skill 副本和 `enhancements/0.6` 快照。
- 文案应去除过度冗余：workflow-state 保持短硬门禁，详细规则集中在 workflow hub 与 `trellis-route` skill。
- 不改变 `.trellis/.route-prefs.tmp` 的私有默认偏好语义；它仍是开发者本地偏好，不作为开工授权。
- 不要求用户每次修复或重检时重新选择模式，除非用户显式覆盖或当前任务没有合法 route 状态。

## Acceptance Criteria

- [x] `trellis-route` 输出模板包含结构化 `route_decision`，至少包含 `target`、`mode`、`source`、`scope`、`task` 或等价字段。
- [x] `trellis-route` 文案明确：当前任务内最近有效 route 状态默认复用；无合法来源时必须重新 route / fallback 询问。
- [x] workflow hub 与 `workflow-state:in_progress` 文案区分“首次无状态需要 route”和“已有合法 route 状态可复用”，不再只描述同一轮 repair/recheck。
- [x] 文案明确禁止把普通对话、compact summary、SessionStart 摘要、`codex-mode`、空 `.route-prefs.tmp` 当作 route 来源。
- [x] `.agents`、`.claude`、`enhancements/0.6`、`vendor/skill-garden/.trellis/0.6` 中的 route skill 与 workflow override 语义一致。
- [x] 若有运行时状态文件或 helper 脚本，文件位于 `.trellis/.runtime/` 或其他 gitignored 路径，且不会进入提交。
- [x] 现有 `d0749e1` 的“check 失败后不反复问”语义被保留，并扩展为任务内合法 route 状态复用。
- [x] 通过搜索验证不再存在“无有效 route 时默认 inline check”或“compact summary 可作为 route 决策”的含义。

## Validation Notes

- 已运行 `npm run sync`，`enhancements/0.6` 从 `vendor/skill-garden/.trellis/0.6` 重新生成。
- 已验证 `.agents` / `.claude` / `enhancements` / vendor 源中的 `trellis-route` 与 workflow override 语义一致。
- 已运行 `git diff --check` 和 Node ESM 语法校验。
- `node scripts/check-snapshot.mjs` 当前仅因 `enhancements/` 未提交而失败；这是发布前置脚本的预期行为，提交快照后应再运行。

## Out of Scope

- 不实现新的跨平台 UI 组件。
- 不改变 Trellis 任务创建、归档、提交和 `trellis-push` 门禁。
- 不删除 `trellis-route` 的个人默认偏好功能。
- 不把 route 状态作为长期跨任务团队配置；默认只作用于当前任务或当前任务会话。
