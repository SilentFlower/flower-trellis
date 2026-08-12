# Brief — 升级上游 Trellis 至 0.6.14

## Goal

- 将 Flower-Trellis 捆绑的 Trellis 精确基线从 `0.6.12` 升级到稳定版 `0.6.14`，吸收上游修复并保证 Flower 现有加强功能、所有权和升级安全无回归。

## Scope

- 升级 `@mindfoldhq/trellis` 与 `@mindfoldhq/trellis-core` 到精确版本 `0.6.14`，把新版 Flower 的 tested baseline 更新为仅 `0.6.14`。
- 重定基线 `session-context-update-boundary`，新增共享 SessionStart 局部 Patch，移除 Trellis 原生更新提示 relay，同时保留 `<first-reply-notice>` 和其它上游 SessionStart 能力。
- 重定基线 `trellis-meta` 平台 Skill Root 章节，适配 `collect<Platform>Templates()` 架构并保留 21 个平台 root 与 Flower ownership 说明。
- 吸收并验证 `0.6.13`、`0.6.14` 的跨平台 shell-ticket、平台检测、cwd fallback、PreToolUse matcher、压缩 memory 恢复和 Grok session 支持。
- 更新 Skill-Garden canonical、compatibility/conflicts、compiled targets、Flower snapshot、dogfood、README、长期 spec 和所有精确版本测试。
- 验证 `0.6.12 -> 0.6.14` 普通 update dry-run 零写入、真实失败补偿、required Patch fail-closed 和重复 Plugin replay 幂等。

## Non-Goals

- 不升级或兼容 Trellis `0.7.0-beta.*`。
- 不让新版 Flower 同时维护 `0.6.12` 与 `0.6.14` 两套 tested Patch baseline。
- 不改变 `trellis-route`、Check-All、auto-loop、untracked flow、Task Brief、任务生命周期、更新确认或 Plugin ownership 的既有产品策略。
- 不在本任务内执行 npm 发布、打 tag 或决定 Flower 发行版本号，也不重构无关功能。

## Key Decisions

- 采用“上游能力优先、Flower 差异局部合并”：以官方 `0.6.14` 全平台模板为新 baseline，禁止 whole-file replacement 覆盖相邻上游修复。
- Flower 继续独占 update/self-update 用户入口；上游 `get_update_hint()` 与 SessionStart 更新文案必须移除，但 first-reply notice、会话识别和 Hook 修复必须保留。
- 新版只承诺 `0.6.14`；旧 `0.6.12` 项目通过正常 Flower update 先升级 Trellis 再重放 Plugin，不支持新版 Patch 直接对旧基线执行 enhance-only。
- `trellis mem` runtime 直接继承上游实现；Flower 只补齐 `trellis-session-insight` 的 Grok 能力说明，不虚构 OpenCode memory 支持。
- canonical、compiled target、snapshot 和 dogfood 必须整体收敛；任何一层无法通过时整体回退，禁止混合版本基线。

## Key Context

- 当前依赖入口是 `package.json`、`package-lock.json`；兼容策略位于 `vendor/skill-garden/.trellis/0.6/overrides/compatibility.json`。
- 直接预检有 20 条 required 失败，归并为两个根因：`session_context.py` 的 2 个 selector，以及 `trellis-meta` 在 18 个平台副本上的 section fingerprint。
- 共享 SessionStart 更新提示是未被这 20 条完全表达的语义冲突，需要同时处理 9 份平台副本并增加最终产物断言。
- 现有 Flower configurator 深层导入在 `0.6.14` 保持兼容；主要风险位于 Patch/Hook 语义，不是 CLI 或 Plugin Runtime API 重构。
- 详细证据位于 `research/upgrade-assessment.md`；上一轮 `0.6.12` 任务中确认的 Flower/Trellis 所有权边界继续有效。

## Risks / Deferred

- 最高风险是只修 `session_context.py` 后留下双更新入口、无提示或死 relay；必须组合验证 SessionStart 最终产物。
- Active Task Patch 虽然大多仍能命中，但可能语义上遮蔽新的 shell-ticket/context key，需要跨平台组合回归。
- 同一根因会被 9 或 18 个平台副本放大，必须依赖 canonical 生成和集合断言，不能逐平台手工修补。
- npm 发布、tag 和 Flower 发行版本选择延后到独立发布流程。

## Acceptance

- `package.json`、锁文件、依赖树和 `flower-trellis -v` 一致显示 Trellis/Core `0.6.14`。
- 官方 `0.6.14` 全平台 fixture 的 required preflight、conflict audit、Patch targets 和 compiled target check 为零错误。
- 最终 SessionStart 只有 Flower 更新入口，保留 first-reply notice、平台识别、会话上下文和其它上游行为。
- Gemini、Qoder、CodeBuddy、Droid、Trae、ZCode session identity，以及 CodeBuddy/ZCode/Trae 检测、cwd fallback、matcher 回归通过；Flower active-task 完整性契约不回退。
- `trellis-meta` 与 21 平台 root、`trellis mem` 压缩恢复、Grok session 和 `trellis-session-insight` 文档保持一致。
- `compatibility.json.testedVersions` 仅为 `0.6.14`；同线未测试 warning 与 `0.7+` fail-closed 继续有效。
- `0.6.12 -> 0.6.14` update dry-run 来源树零写入，失败补偿、`--no-enhance`、错误旧基线 enhance-only 和重复 replay 测试通过。
- 完整 Node/Python 测试、sync、strict context budget、输出模板、npm pack、dogfood 二次重放、快照/compiled target 和双仓 diff 门禁全部通过。

## Next Step

- 实现与 full Check-All 已完成；下一阶段由 `trellis-update-spec` 复核长期契约，再按用户授权进入 `trellis-push`，本任务不执行 npm 发布或 tag。
