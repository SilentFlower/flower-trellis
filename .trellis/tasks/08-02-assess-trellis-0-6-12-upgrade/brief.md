# Brief — 评估并实施 Trellis 0.6.12 升级

## Goal

- 把 flower-trellis 的 Trellis 基线从 `0.6.5` 升级到 `0.6.12`，完整吸收上游安全修复与平台机制，同时保留 Flower 已确认的工作流策略、状态完整性和最终批准边界。

## Scope

- 将 `@mindfoldhq/trellis` 及 lockfile 中 Trellis Core 精确升级到 `0.6.12`。
- 重基线并合并 61 条 required Patch 失败，保证 required preflight、conflict policy 和事务 zero-write。
- 合并 active-task、fallback 清理、task store、Session Context 等 Python 控制面变化。
- 退役 workflow-state whole-file replacement，改为局部、有序、required Patch。
- 将 Codex managed capability 基线改为 `auto`，实际执行模式继续由 `trellis-route` 决定。
- 保留 Flower Phase 2、audit-only Check-All、untracked/auto-loop/pre-check 和完成链所有权。
- 合并上游 Planning Contract，但最终只保留一次 Flower Brief 批准。
- 接入 Oh My Pi、Grok、Kimi、Snow，并完成 Pi `.pi/skills -> .agents/skills` 迁移。
- 刷新 compatibility/conflicts、compiled targets、`enhancements/0.6` 和当前 dogfood 输出。
- 完成定向测试、全量测试、上下文预算、npm tarball 和升级 dry-run 验证。
- 统一 Codex `auto` 在 config、hook、meta、route 中的能力语义，消除“默认 subagent”误导。
- 把跨版本 update dry-run 改为项目外沙箱联合预演，并为真实 Trellis + Plugin 链增加失败补偿恢复。
- 在 Plugin preflight 写入前扩展补偿快照，覆盖本轮新引入的外部 owned paths 及原本不存在的父目录。
- 为支持原生 agent discovery 的平台和 channel 投影专用 audit-only `trellis-check-all` 角色；可写 `trellis-check` 拒绝 Check-All 意图。
- 用结构化平台 dispatch 能力清单替代 route 中的静态 Markdown 全平台表。
- 激活现有 `completed` 为真实待归档状态：先同步 final progress，成功后才本地完成，补齐 reopen、continue 与 archive 状态链。
- 统一 managed workflow 自定义说明和 `trellis-meta` route 文案，明确 canonical Patch owner 与统一 Check-All 入口。
- 分离共享 `.agents/skills` 物理投影与逻辑平台检测，避免未启用的 Gemini、Pi、Kimi 被误写入 state 或创建私有目录。

## Non-Goals

- 不评估或支持 Trellis `0.7.0-beta.*`。
- 不让新版 Flower 同时承诺 `0.6.5` 与 `0.6.12` 两套 tested baseline。
- 不保留上游 workspace-write `trellis-check` 作为 Flower Check-All 替代。
- 不为 Grok/Kimi 等无项目 hook 能力的平台伪造 hook。
- 不发布 npm 版本、不创建标签、不推送远端；Git 收尾仍由后续 `trellis-push` 单独确认。

## Key Decisions

- Flower 继续拥有 Phase 2、统一 Check-All、untracked/auto-loop/pre-check 与完成链策略；上游只提供平台机制和原生 dispatch 能力。
- Codex `dispatch_mode=auto` 只声明原生上下文与 readiness 能力，实际 inline/subagent 模式只由 `trellis-route` 决定。
- 上游 Planning Contract 与 Flower Task Brief Handoff 合并为一个最终批准点；Brief 展示 Key Decisions，但不复制完整决策台账，也不附加 Artifact Status。
- Skill-Garden 0.6 改动必须从 canonical Patch 源生成 snapshot、compiled target 和 dogfood，不允许旁路修改生成结果。
- 新版 Flower 只承诺 Trellis `0.6.12` tested baseline；跨版本升级通过项目外沙箱预演和失败补偿保证目标项目安全。

## Key Context

- Skill-Garden canonical 源是 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/` 和 dogfood 副本不能作为独立修改源。
- 所有 0.6 workflow、skill、hook 和脚本差异必须通过现有 Patch Engine 表达，禁止新增旁路 injector。
- 兼容、required selector/baseline 或 conflict error 必须在目标文件和 `.flower/` 状态写入前失败。
- 共享 `.agents/skills` 必须对 Codex/Gemini/Pi/Kimi 生成 byte-identical neutral 内容。
- 共享物理 Skill root 不等于共享逻辑平台状态；当前 dogfood 只启用 Claude 与 Codex。
- 正常升级顺序是 Flower npm 精确依赖、全局 Trellis 同步、项目 `trellis update`、Plugin 重放。
- Trellis `0.6.12` 导出的 `ALL_MANAGED_DIRS` 是 update 补偿范围的基础；task/spec/workspace/backlog/worktree 等用户数据不得纳入自动恢复删除范围。
- `trellis-check` 和 `trellis-check-all` 是两个不同角色：前者可写并自修，后者统一只读 collect-all。
- 规划与实现仍隔离：当前任务已经是 `in_progress`，本轮因 D10-D14 回退规划复核；只有批准最新 Brief 后才能通过 `trellis-route(target=implement)` 恢复实现。

## Risks / Deferred

- workflow-state 局部 Patch 的顺序或 selector 若设计不完整，可能造成重复分支或覆盖上游新能力；required preflight 和 final conflict assertions 必须覆盖。
- 新平台 dispatch API 不同，route recipe 必须逐平台验证，不能用一套固定 Agent 调用模板。
- Brief/Workflow 扩展可能增加高频上下文，必须检查最终 compiled target 和 SessionStart budget，不能通过提高阈值消除告警。
- 新版不保证直接对 Trellis `0.6.5` 运行 `--enhance-only`；旧项目应走正常 update/self-update 升级链。
- Trellis `0.7 beta` 的兼容处理延后到独立任务。
- update 补偿必须严格复用上游受管根和排除规则；范围漂移可能造成漏恢复或误触用户数据，需 fixture 与故障注入覆盖。
- 专用 agent 文件正确不等于实际启动成功；subagent dispatch 遇到 launcher、target 或资格不可用时必须明确停止，不提前过滤 route 选项。
- completed 转换必须晚于业务 push 和 progress sync；任何 progress commit/push 失败都保持 `in_progress`，本地完成态写失败只允许重试 helper。

## Acceptance

- D01-D15 的证据、归类和确认结论均可追溯，61 条原始失败及后续残余审计问题没有未解释项。
- 官方 `0.6.12` full fixture 的 required Patch preflight 和 conflict 审计无 error，错误场景保持 zero-write。
- Active-task、task store、workflow-state、Codex route、Brief gate 和新平台矩阵的定向测试通过。
- `PLATFORM_FLAGS`、Skill targets、Patch targets 和 fixture 覆盖 OMP/Grok/Kimi/Snow/Pi 正确目录与能力。
- `compatibility.json.testedVersions` 只在完整验证通过后声明 `0.6.12`。
- vendor canonical、`enhancements/0.6`、compiled targets 和 dogfood 最终语义一致。
- `npm test`、Patch targets、AI context budget、版本输出、update dry-run、npm pack 和 diff 检查通过。
- Codex config/hook/route 组合语义测试通过，不再把 `auto` 解释为 route 默认值。
- 跨版本 dry-run 对目标项目 zero-write；Plugin 失败故障注入能恢复旧 Trellis/Flower 受管状态并保留恢复证据。
- 专用 Check-All agent、可写 check intent guard、结构化 dispatch catalog 和 compiled target 闭包测试通过。
- 仅启用 Claude/Codex 时 state 只记录这两个平台，且 `.gemini`、`.pi`、`.kimi-code`、`.kiro` 均不存在。
- 正常 push 的 final progress 同步成功后任务仍可由活动指针解析且状态为 `completed`；progress push 失败、partial/commit-only 保持 `in_progress`，reopen/archive 路径通过。
- 最终质量检查后仍通过 `trellis-update-spec` 和 `trellis-push` 完成规范与 Git 收尾。

## Next Step

- `trellis-meta` owner 路由修复与 full Check-All 重检已通过；下一步等待用户回复 `继续`，进入 `trellis-update-spec`，再由 `trellis-push` 生成 Git 收尾计划。
