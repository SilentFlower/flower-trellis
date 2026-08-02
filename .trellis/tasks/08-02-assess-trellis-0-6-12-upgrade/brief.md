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

## Non-Goals

- 不评估或支持 Trellis `0.7.0-beta.*`。
- 不让新版 Flower 同时承诺 `0.6.5` 与 `0.6.12` 两套 tested baseline。
- 不保留上游 workspace-write `trellis-check` 作为 Flower Check-All 替代。
- 不为 Grok/Kimi 等无项目 hook 能力的平台伪造 hook。
- 不发布 npm 版本、不创建标签、不推送远端；Git 收尾仍由后续 `trellis-push` 单独确认。

## Key Decisions

- D01：以上游 `0.6.12` active-task API 为基础，保留 Flower 的 corrupt/io_error 区分、原子 fsync 写入和结构化清理结果。
- D02：Codex 输出正式值 `auto`；inline/subagent 只由 `trellis-route` 决定，始终 inline 使用 route preference。
- D03：退役 489 行 workflow-state whole-file replacement，拆为局部 required Patch。
- D04：上游拥有平台机制，Flower 拥有 Phase 2 策略，`trellis-route` 连接两者；无只读 subagent 能力的平台使用 inline Check-All。
- D05：最终 Brief 是唯一实施批准点；保留独立 Non-Goals、Key Decisions、一跳 Next Step，Artifact Status 动态展示。
- D06：更新提示没有新设计冲突，仅重基线 imports/helper selector，Flower 更新链保持不变。
- D07：吸收上游 task create 激活诊断，保留 Flower 跨文件补偿，并把写失败规则扩展到 `set-meta`。
- D08：按 D04 完整接入 OMP/Grok/Kimi/Snow，Pi Skill 迁到共享 `.agents/skills`。
- D09：新版 Flower 只声明 Trellis `0.6.12` 为 tested version；npm 精确依赖和正常 update/self-update 链负责版本配对。

## Key Context

- Skill-Garden canonical 源是 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/` 和 dogfood 副本不能作为独立修改源。
- 所有 0.6 workflow、skill、hook 和脚本差异必须通过现有 Patch Engine 表达，禁止新增旁路 injector。
- 兼容、required selector/baseline 或 conflict error 必须在目标文件和 `.flower/` 状态写入前失败。
- 共享 `.agents/skills` 必须对 Codex/Gemini/Pi/Kimi 生成 byte-identical neutral 内容。
- 正常升级顺序是 Flower npm 精确依赖、全局 Trellis 同步、项目 `trellis update`、Plugin 重放。
- 规划与实现仍隔离：当前任务状态保持 planning，只有批准本 Brief 后才能运行 `task.py start`。

## Risks / Deferred

- workflow-state 局部 Patch 的顺序或 selector 若设计不完整，可能造成重复分支或覆盖上游新能力；required preflight 和 final conflict assertions 必须覆盖。
- 新平台 dispatch API 不同，route recipe 必须逐平台验证，不能用一套固定 Agent 调用模板。
- Brief/Workflow 扩展可能增加高频上下文，必须检查最终 compiled target 和 SessionStart budget，不能通过提高阈值消除告警。
- 新版不保证直接对 Trellis `0.6.5` 运行 `--enhance-only`；旧项目应走正常 update/self-update 升级链。
- Trellis `0.7 beta` 的兼容处理延后到独立任务。

## Acceptance

- D01-D09 的证据、归类和确认结论均可追溯，61 条失败没有未解释项。
- 官方 `0.6.12` full fixture 的 required Patch preflight 和 conflict 审计无 error，错误场景保持 zero-write。
- Active-task、task store、workflow-state、Codex route、Brief gate 和新平台矩阵的定向测试通过。
- `PLATFORM_FLAGS`、Skill targets、Patch targets 和 fixture 覆盖 OMP/Grok/Kimi/Snow/Pi 正确目录与能力。
- `compatibility.json.testedVersions` 只在完整验证通过后声明 `0.6.12`。
- vendor canonical、`enhancements/0.6`、compiled targets 和 dogfood 最终语义一致。
- `npm test`、Patch targets、AI context budget、版本输出、update dry-run、npm pack 和 diff 检查通过。
- 最终质量检查后仍通过 `trellis-update-spec` 和 `trellis-push` 完成规范与 Git 收尾。

## Next Step

- 用户批准本 Brief 后运行 `task.py start`，再进入 `trellis-route(target=implement)`，从依赖与官方 `0.6.12` fixture 基线开始实施。
