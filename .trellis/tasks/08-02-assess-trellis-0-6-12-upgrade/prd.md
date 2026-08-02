# 评估 Trellis 0.6.12 升级冲突

## Goal

以 Trellis `0.6.12` 稳定版为升级目标，逐项分析它与 Flower-Trellis 现有 Patch、工作流所有权、运行时状态完整性和平台适配设计之间的冲突，区分真实设计选择、重复能力和纯机械重基线。真实设计冲突由用户确认，代码已经确定的机械项直接形成实施与验证要求，最终输出可执行的升级设计和实施计划。

## Background

- Flower-Trellis 当前固定依赖 `@mindfoldhq/trellis: 0.6.5`。
- `enhancements/0.6/overrides/compatibility.json` 当前只登记 `0.6.5` 为已测试版本。
- 在隔离的 Trellis `0.6.12` fixture 上执行 Flower Patch 预检，得到 61 条 required Patch 失败；预检遵守 zero-write，未产生部分写入。
- 61 条失败由平台副本放大，归并后是 8 个 Patch 冲突组；此外还存在平台静态矩阵和 Pi skill root 等未被 required Patch 捕获的隐性冲突。
- 本任务只分析 `0.6.12` 稳定版。`0.7 beta` 保持独立，不进入本任务的兼容结论。

## Requirements

### R1. 逐项归类

每个审计项必须记录：

- 上游 `0.6.12` 的实际变化和代码证据。
- Flower-Trellis 当前设计及其原始目的。
- 是否属于机械 baseline 漂移、实现重叠或真实设计冲突。
- 真实产品或架构选择至少包含两个可行方案、各自影响、推荐方案和用户最终决定。
- 纯机械重基线或既有决定的直接推论必须记录准确失配原因、实施动作和验证要求，不额外要求用户确认代码事实。

### R2. 所有权优先

分析时必须明确区分：

- 上游 Trellis 提供的基础机制和平台运行时能力。
- Flower-Trellis / Skill-Garden 拥有的工作流策略、更新入口、检查门禁和状态完整性增强。
- 可由上游完全接管、需要语义合并、或必须继续由 Flower 拥有的行为。

### R3. 决策台账

| ID | 决策项 | 初始风险 | 状态 |
|---|---|---|---|
| D01 | Active-task 解析、损坏状态和 fallback 清理契约 | 极高 | 已确认：方案 A |
| D02 | Codex `auto/inline` 与 `trellis-route` 的所有权边界 | 高 | 已确认：方案 A |
| D03 | workflow-state whole-file override 是否拆成局部 Patch | 极高 | 已确认：方案 A |
| D04 | Phase 2 Flower owner 与新平台原生 dispatch 的组合方式 | 高 | 已确认：方案 A |
| D05 | 上游最终规划批准与 Flower 自动建 planning task / brief 门禁 | 高 | 已确认：方案 A |
| D06 | Trellis 原生更新提示与 Flower update/self-update 所有权 | 低 | 已归类：机械重基线 |
| D07 | 上游激活诊断与 Flower 跨文件写入完整性 | 中 | 已归类：吸收上游并机械扩展 |
| D08 | OMP、Grok、Kimi、Snow 和 Pi skill root 的平台兼容策略 | 高 | 已确定：由 D04 直接推导 |
| D09 | tested baseline 与升级版本控制 | 中 | 已确认：方案 A |

### R4. 规划与实现隔离

- 逐项确认期间只允许更新任务规划和研究材料。
- 在全部设计决策收敛、生成 `design.md`、`implement.md` 和最终 `brief.md` 前，不运行 `task.py start`，不修改产品代码。
- 用户对最终 brief 的确认才构成升级实施授权。

### R5. 最终升级计划

决策收敛后必须形成：

- 按所有权边界组织的 `design.md`。
- 按依赖顺序组织的 `implement.md`。
- required Patch、平台矩阵、Python/Node、hook、迁移和 AI context budget 验证清单。
- 明确的回滚点，以及何时才能把 `0.6.12` 加入 `testedVersions`。

## Confirmed Decisions

### D01. Active-task 状态完整性

采用方案 A：以 Trellis `0.6.12` 的函数签名、平台识别、`allow_single_session_fallback` 和 `allow_environment_context` 开关为基础，合并 Flower 的增强契约。

必须保留：

- `missing / corrupt / io_error` 的结构化区分。
- 损坏或 I/O 异常的 runtime 不得被当作无任务状态。
- active runtime 的原子替换、flush 和 `fsync`。
- `ClearActiveTaskResult` 及删除失败的显式诊断。
- fallback session 的安全清理，同时兼容上游 `previous.context_key` 修复。

不得用旧 Flower replacement 直接覆盖 `0.6.12` 函数，否则会丢失新增关键字参数和新平台 session 行为。

### D02. Codex dispatch 所有权

采用方案 A：Flower 管理的 Codex 项目把 `codex.dispatch_mode` 规范化为 Trellis `0.6.12` 的 `auto`，将它定义为“原生 subagent 能力已启用”的平台基线；一次任务实际采用 inline 还是 subagent，继续只由 `trellis-route` 决定。

具体边界：

- 不再写入上游兼容别名 `sub-agent`，统一使用正式值 `auto`。
- Flower 管理项目中的显式 `inline` 会被规范化为 `auto`，避免它同时关闭 JSONL seed/readiness，造成 route 仍可选择 subagent、但上下文未准备的契约断裂。
- 希望始终 inline 的用户通过 `trellis-route` 个人偏好表达，不通过平台能力配置全局禁用 subagent。
- 保留历史产品决定：平台配置只声明能力，不能过滤 `trellis-route` 的执行选项。

### D03. workflow-state Patch 粒度

采用方案 A：退役共享 workflow-state hook 的 whole-file replacement，以上游 Trellis `0.6.12` 文件为基础，把 Flower 行为拆成多个小范围、严格有序的 required Patch。

拆分至少覆盖：

- stale active-task 到 `missing_task` 的映射。
- `untracked_flow` 状态读取 helper 和 import。
- breadcrumb subject label/summary 扩展。
- `main()` 中 task、untracked、no-task 的 Flower 分支。
- Codex bootstrap、更新提示等其它 Flower 所有内容的独立 Patch。

每个局部 Patch 继续要求明确 selector、已知 baseline 和 zero-write 预检；本决定只缩小冲突边界，不降低漂移保护强度。

### D04. Phase 2 与平台 dispatch 分层

采用方案 A：Flower 继续独占 Phase 2 的策略所有权，同时完整吸收 Trellis `0.6.12` 的平台原生 dispatch 能力。

所有权划分：

- 上游 Trellis：平台安装产物、agent 定义、hook/context injection、原生 dispatch 工具与限制。
- `trellis-route`：inline/subagent 逻辑选择，以及按需加载的当前平台精确执行配方。
- Flower Phase 2：任务启动门禁、untracked/auto-loop/pre-check 顺序、统一 Check-All 语义和完成链。
- Flower Check-All：保持 audit-only、collect-all；上游 workspace-write、自修复 `trellis-check` 不得作为 subagent Check-All 的替代品。

不具备兼容只读 subagent 的平台不提供 subagent Check-All，必须由用户改选 inline；不得静默降级到可写检查 agent。

### D05. 单一最终 Brief 批准点

采用方案 A：吸收 Trellis `0.6.12` 的 Planning Contract、Requirement Convergence Gate 和 final review 原则，但不新增第二个 final summary 批准流程；Flower 管理项目以最终 Brief handoff 作为唯一实施批准点。

具体规则：

- 高置信复杂实施意图仍可自动创建 planning task，但只授权规划，不授权 `task.py start` 或实现。
- 逐项问答只批准对应设计选择；完整展示最终 Brief 后的明确回复才构成默认实施授权。
- `brief.md` 保留 Goal、Scope、独立 Non-Goals、Key Context、Acceptance 和一跳 Next Step；新增 Key Decisions，并仅在存在时生成 Risks / Deferred。
- Artifact Status 不写入持久文件，在展示 Brief 时根据三件套、JSONL 和 Open Questions 实时生成。
- 保留窄范围 Brief 预授权例外，以及 `task.py start` 对 Brief 缺失和过期的确定性硬门禁。
- 规划实质变化后必须刷新、重新展示并重新批准 Brief。

### D06. Session Context 更新提示无需重新决策

官方 `0.6.5` 已包含原生 Session Context 更新提示，Flower 也已通过 `session-context-update-boundary` 将其移除并交给独立 `flower_update_hook.py`。`0.6.12` 没有引入新的产品所有权冲突，本轮 2 条预检失败仅为 selector 漂移：

- imports 区新增 `sys`，用于上游 polyrepo 上限警告；重基线时必须保留。
- helper 提示文本从 `run trellis upgrade` 修正为 `run trellis update`；Flower 仍删除整个 helper 区域。

实施阶段只重基线对应 selector/content，保留 Flower 当前更新提示、确认、Plugin 重放和更新后 Push 链，不新增状态归一化或双提示机制。

### D07. Task store 写入完整性无需重新决策

吸收 Trellis `0.6.12` 已增强的 task create 激活诊断，退役重复的 `task-create-active-warning` Patch。保留 Flower 对初始写入、parent/child 双文件补偿、archive、set-* 和 decision log 的失败关闭契约；上游新增 `set-meta` 必须机械补齐 `write_json()` 失败检查。

### D08. 新平台矩阵由 D04 直接推导

按 D04 已确认的平台机制分层完整接入 Oh My Pi、Grok、Kimi、Snow，并把 Pi 强化 Skill 从 `.pi/skills` 迁到 `.agents/skills`。新增平台必须进入 flag、Skill target、fixture、Patch target 和 route dispatch 能力矩阵；无项目 hook 能力的平台不得伪造 hook。

### D09. 新版只承诺 Trellis 0.6.12

采用方案 A：新版 Flower 的 `testedVersions` 只声明 Trellis `0.6.12`，不同时维护 `0.6.5` 的新版 Patch 运行承诺。

该边界由正常 npm 更新链保证：

- `flower-trellis` 对 `@mindfoldhq/trellis` 使用精确版本依赖；升级版本将依赖从 `0.6.5` 精确改为 `0.6.12`。
- `flower-trellis update` 先把全局 Trellis 同步到当前 Flower 捆绑的精确版本，再运行项目 `trellis update`，最后重放 Skill-Garden 与其它 Plugin。
- `self-update` 先安装目标 Flower npm 版本，再调用新版本的 `flower-trellis update`，因此正常升级路径会使用匹配的 Flower/Trellis 组合。
- Patch compatibility 与 required preflight 继续 fail closed，防止手动混用版本、直接对旧项目运行 `--enhance-only` 或依赖安装损坏时发生部分写入。

新版 Flower 仍保证从旧项目升级到 `0.6.12` 的路径，但不保证新版 Patch 可直接应用在仍停留于 `0.6.5` 的项目上。

## Acceptance Criteria

- [ ] D01-D09 均有代码证据和明确归类；真实设计冲突包含方案比较、推荐意见和用户确认，纯机械重基线项包含准确失配原因与验证要求。
- [ ] 61 条预检失败均映射到明确决策或纯机械重基线步骤，没有遗漏。
- [ ] 新平台和 Pi `.pi/skills -> .agents/skills` 迁移等隐性冲突已纳入设计。
- [ ] 明确哪些上游能力完整吸收、哪些与 Flower 合并、哪些继续由 Flower 独占。
- [ ] `prd.md` 完成收敛整理，不保留已解决的临时问题或重复结论。
- [ ] 创建完整的 `design.md`、`implement.md` 和真实 `implement.jsonl` / `check.jsonl`。
- [ ] 最终 `brief.md` 已展示并得到用户后续明确批准，才允许进入实现阶段。

## Out of Scope

- Trellis `0.7.0-beta.*` 的兼容性和升级决策。
- 在最终 Brief 批准前修改 Flower-Trellis 产品代码或 Patch 内容。
- 发布新的 Flower-Trellis npm 版本、创建标签或推送远端。
