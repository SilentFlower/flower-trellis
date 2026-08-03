# 简化 Untracked 流程游标与 Push 路由

## Goal

把 Flower/Skill-Garden 0.6 的 untracked 机制收缩为轻量流程游标：它只记录当前无任务工作的阶段，并通过面包屑把 Agent 路由到正确 owner；不再用 workspace fingerprint、scope 或阶段证据阻止合法编辑。进入 `push` 阶段时必须明确加载 `trellis-push`，实际 Git 安全继续由该 skill 负责。

## Background

- `untracked_flow.py` 于 2026-07-31 的 Skill-Garden 提交 `b3da69f17e6e156ffe21dc4885e6f4f72e23d25b` 引入。
- 当前 helper 同时记录 baseline、scope、focused validation、Check-All、Update-Spec 和完整 workspace fingerprint，并把它们作为阶段推进前置条件。
- `scope` 目前只是事项元数据，不是稳定的校验边界；因此 Check-All 后合法写入 `.trellis/spec/**` 也会改变完整 fingerprint，触发 `workspace-drift`。
- 当前所有 untracked 阶段共用一段通用面包屑。`stage=push` 虽然包含一句 `load trellis-push`，但提示被其它阶段说明稀释，不能形成明确的一跳路由。
- Check-All、Update-Spec 和 Trellis Push 已各自拥有实际检查、规范写入和 Git 安全职责；untracked 无需复制这些 owner 的证据或门禁。
- 0.6 authoring source 位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/` 是同步快照，根项目 `.trellis/`、`.agents/`、`.claude/`、`.codex/` 是 dogfood 结果。

## Requirements

### R1. Untracked 只保存流程游标

- session 状态只保留工作标识、摘要、来源、当前阶段和时间戳等恢复流程所需字段。
- 正常阶段为 `implement -> check -> spec -> push`；旧状态中的 `inspect` 在读取或下一次写入时兼容映射到 `implement`。
- `advance --stage <stage>` 只更新当前阶段，不校验 workspace fingerprint、scope、focused validation、Check-All 或 Update-Spec 证据；需要返工时允许把阶段设回 `implement`。
- 保留 `begin`、`status`、`session-start-hint` 和 `clear`，继续保证一个 session 同时只有一个当前 untracked 事项。
- 移除 `prepare-edit`、`record-validation`、`record-check`、`record-spec` 及其证据状态；不再产生 `workspace-drift` 作为 untracked 阶段推进错误。

### R2. 阶段 owner 负责真实流程

- direct edit 建立 untracked 状态后进入 `implement` owner；实现完成后把游标更新为 `check`。
- Check-All 发现问题时把游标设回 `implement`；严格通过且继续完成链时更新为 `spec`。
- Update-Spec 的 `no-op` 或 `written` 更新为 `push`；`needs-review` 保持在 `spec`。
- Trellis Push 只要求当前 untracked 游标为 `push`，然后执行其既有正式计划、用户确认、精确文件范围和 Git 检查；成功后 `clear`。
- untracked helper 不判断 owner 是否真的通过。流程质量由对应 skill 的现有契约、输出和测试负责。

### R3. 阶段专用面包屑

- per-turn hook 根据当前阶段选择一跳提示，而不是为所有阶段注入完整通用流程。
- `implement` 只路由到实现 owner，`check` 只路由到 `trellis-check-all`，`spec` 只路由到 `trellis-update-spec`，`push` 只路由到 `trellis-push`。
- `push` 面包屑必须明确说明：读取当前 untracked 状态后加载 `trellis-push`；不得把 `stage=push` 误当成已经执行 Push。
- 面包屑不复制各 owner 的完整执行规则、证据 schema 或 Git 命令。

### R4. Task adoption 与兼容

- `task_intent.py adopt` 读取 untracked 状态时不再验证 workspace fingerprint，也不依赖旧 baseline/evidence/scope 字段。
- adoption 只保留事项标识和 adopted stage 作为轻量来源标记；任务标题与描述使用 adoption 请求参数，Git baseline 由 task owner 在 adoption 当下重新捕获，不要求复制 untracked 的摘要或来源。
- 旧 v1 untracked runtime 必须可读取并平滑迁移；删掉的字段被忽略，不要求用户手工清理 session。
- 修改 Skill-Garden 0.6 authoring source，运行既有同步与 dogfood 流程；0.5 和 old 变体不变化。

## Acceptance Criteria

- [ ] AC1：无任务 direct edit 能建立游标，并按 `implement -> check -> spec -> push` 恢复和推进。
- [ ] AC2：任意合法代码、测试、任务或 `.trellis/spec/**` 变化都不会被 untracked helper 以 `workspace-drift` 阻止；helper 不再要求 scope 或阶段证据。
- [ ] AC3：Check-All、Update-Spec 和 Trellis Push 的 owner 文案不再调用 `prepare-edit`、`record-validation`、`record-check` 或 `record-spec`。
- [ ] AC4：进入 `stage=push` 后，per-turn hook 注入专用 Push 面包屑，明确加载 `trellis-push`；不会重放实现、检查或规范步骤。
- [ ] AC5：`trellis-push` 仍执行既有计划、用户确认、精确文件范围和 Git 安全检查；本任务不新增 push token/helper 门禁。
- [ ] AC6：旧 v1 runtime 可读取，`inspect` 可兼容迁移到 `implement`；task adoption 能基于当前工作区重新建立任务 baseline。
- [ ] AC7：vendor、snapshot、dogfood 和平台副本一致，Python/JS 定向测试、Patch conflict、snapshot、context budget、`npm test`、diff check 与任务校验通过。

## Out of Scope

- 不新增 `prepare-spec`、exact-path fingerprint 排除或任何受控规范写入批次。
- 不新增 `push_gate.py`、计划摘要令牌、confirmed/authorized 状态或新的 Git 拦截器。
- 不把 untracked 设计成可审计事务、证明链或隐藏的迷你任务系统。
- 不放松 `trellis-push` 自身的 Git 检查、用户确认和精确文件范围要求。
- 不改变 auto-loop、任务 progress、finish-work、release/deploy 或 0.5/old 行为。
