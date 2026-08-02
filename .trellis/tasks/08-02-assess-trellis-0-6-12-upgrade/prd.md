# 评估 Trellis 0.6.12 升级冲突

## Goal

以 Trellis `0.6.12` 稳定版为升级目标，逐项分析它与 Flower-Trellis 现有 Patch、工作流所有权、运行时状态完整性和平台适配设计之间的冲突，区分真实设计选择、重复能力和纯机械重基线。真实设计冲突由用户确认，代码已经确定的机械项直接形成实施与验证要求，最终输出可执行的升级设计和实施计划。

## Background

- 升级前 Flower-Trellis 固定依赖 `@mindfoldhq/trellis: 0.6.5`，兼容清单也只登记 `0.6.5`。
- 在隔离的 Trellis `0.6.12` fixture 上执行首次 Flower Patch 预检，得到 61 条 required Patch 失败；预检遵守 zero-write，未产生部分写入。
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
| D10 | Codex `auto` 能力语义与 hook/config/route 文案一致性 | 高 | 已批准并实施：统一语义源与跨 owner 断言 |
| D11 | 跨版本 update dry-run 与 Trellis/Plugin 事务边界 | 极高 | 已批准并实施：沙箱预演、预检扩展快照与失败补偿 |
| D12 | audit-only Check-All 的专用 agent 与直接调用防绕过 | 高 | 已批准并实施：专用只读角色 + 自修复 agent 拒绝 Check-All |
| D13 | 多平台 dispatch recipe 的静态 Markdown 漂移 | 高 | 已批准并实施：结构化能力清单 |
| D14 | Phase 3.4 后缺少可观察的待归档任务状态 | 中 | 已批准并实施：progress push 成功后激活现有 `completed` |
| D15 | 共享 `.agents/skills` 导致未启用逻辑平台误投影 | 高 | 已发现并修复：物理 target 与逻辑平台检测分离 |

### R4. 规划与实现隔离

- 原 D01-D09 已实施并验证；D10-D14 属于实施后审计发现的实质范围扩展，D15 是 Git 收尾前 dogfood 复核发现的平台检测缺口。
- D10-D14 收敛期间曾只允许更新任务规划材料；最新 Brief 已完整展示并得到用户明确批准。D15 属于 D08/D12 已批准边界内的错误修复，当前实现授权有效。
- 后续复核发现的缺口若属于 D11/D14 或既有 managed ownership 契约，可在本任务内修复并回写任务材料；新增产品决策仍需再次回到规划批准。

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

### D10. Codex dispatch 语义统一

Flower 管理项目继续把 `codex.dispatch_mode` 规范化为 `auto`，但必须把配置注释、workflow-state hook banner、`trellis-meta` 和 `trellis-route` 的表述统一为同一个契约：

- `auto` 只表示 Codex 原生 subagent 上下文与 JSONL readiness 能力可用，不表示默认选择 subagent。
- 本轮实际执行位置只读取 `trellis-route` 的 task/session 决策或个人偏好；hook 不得从 `auto` 推导执行模式。
- Flower 管理项目不输出 `inline`；上游兼容输入仍可识别，但“始终 inline”只能通过 route preference 表达。
- required conflict assertions 必须同时校验 config、hook 和 route 三个 owner，避免各自测试通过但组合语义互相矛盾。

### D11. Update 沙箱预演与失败补偿

跨版本 `flower-trellis update --dry-run` 不再跳过 Skill-Garden，而是在项目外临时沙箱中构造升级所需的 Trellis 管理面、`.flower` 元数据和既有 Plugin-owned paths，真实执行沙箱内的 `trellis update`，再对升级后树执行 Plugin replay 预检。目标项目保持 zero-write。

真实更新增加 Flower 级补偿边界：

- 更新前在项目外建立带路径清单、内容和 mode 的补偿快照，范围覆盖 Trellis `ALL_MANAGED_DIRS`、根 `AGENTS.md`、`.flower` 元数据和既有 Plugin-owned paths；Plugin preflight 在真实写入前把本轮计划触达的新外部路径补入快照。Trellis 明确排除的 task/spec/workspace/backlog/worktree 等用户数据保持排除。
- `trellis update` 成功后才运行 Plugin replay；Plugin 继续使用自身 Transaction Writer 保证内部原子性。
- 任一后续步骤失败时，Flower 按快照恢复旧文件、删除本轮新增的受管文件并恢复元数据；Trellis 本轮生成的 `.trellis/.backup-*` 保留为人工恢复证据。
- 补偿失败必须返回结构化错误、未恢复路径和备份位置，禁止把部分升级报告为成功；config preserve 只在整条链成功后提交。

### D12. 专用 audit-only Check-All agent

对具备项目 subagent discovery 的平台投影独立 `trellis-check-all` agent，并新增 `.trellis/agents/check-all.md` 供 channel runtime 使用。该角色只读执行 collect-all，返回 `CHK-*` / `DOC-*` 候选，不得修改代码、测试、配置或任务文件。

既有 `trellis-check` 保持 workspace-write/self-fix 职责，但所有平台副本和 channel `check` role 必须增加显式边界：收到 Check-All、全面检查或提交前统一检查意图时拒绝执行，并指向 `trellis-check-all`。`trellis-route` 的 subagent check 只能选择结构化能力清单声明的专用只读角色；不再用可写 `trellis-check` 或未声明只读能力的通用 agent 兜底。

### D13. 结构化平台 dispatch 能力清单

把 `trellis-route` 中手写的平台启动表迁为随 skill 分发、可校验的结构化清单。每个平台记录稳定 ID、实现 agent 启动契约、Check-All 专用角色路径/格式、是否允许 subagent Check-All、inline-only 原因和验证级别。

- route skill 只保留选择算法和 prompt 契约，按当前平台读取清单条目，不重复维护整张 Markdown 表。
- 内容投影、agent 目标和测试复用同一清单或对其做确定性闭包校验。
- schema、平台覆盖、目标文件存在性、inline-only 原因和 compiled target 一致性必须自动测试。
- 清单不能伪造 host 工具可用性；运行时仍需确认当前 host 暴露对应 dispatch API，未确认时 fail closed 为 inline-only。

### D14. 激活 `completed` 待归档状态

不新增第四种近义状态，直接激活 Trellis 已存在但正常流中不可观察的 `completed`：

- 普通 `trellis-push` 在全部业务 commit/push 成功后先写入并推送最终 progress，任务仍保持 `in_progress`；只有 progress commit/push 成功后才用同一份 progress 原子执行本地 `in_progress -> completed`，保留活动任务指针。
- 本地完成态不再创建第二个 progress commit，由后续显式 `trellis-finish-work` 的 archive bookkeeping commit 承接。
- 部分成功、commit-only、auto-loop 内部提交或进度同步失败均保持 `in_progress`。
- `[workflow-state:completed]` 与 `trellis-continue` 只指向 `trellis-finish-work`；`task.py archive` 要求任务已 completed，并保留已有 `completedAt`。
- 新增显式 reopen 路径，把尚未归档的 `completed` 恢复为 `in_progress` 并清理 `completedAt`；实质规划变化仍先刷新 Brief 并重新批准。
- 无活动指针时的进度候选扫描同时识别 `completed`，避免完成后 session 丢失导致任务不可恢复。

### D15. 分离共享物理 Skill target 与逻辑平台检测

Codex、Gemini、Pi、Kimi 继续共享 `.agents/skills` 的 neutral 内容，但该物理目录不能证明四个平台都已启用：

- `ENHANCEMENT_SKILL_TARGETS` 为共享 target 分别登记平台原生 `trellis-implement` 检测路径。
- 自动检测只选择实际存在原生入口的平台；显式 `--platform` 仍可选择任意受支持平台。
- 普通 Plugin update/replay/remove 在没有新显式选择时复用既有 state 平台，只有首次安装才依赖自动检测。
- Plugin 投影不得用自己创建的 `trellis-check-all` 文件反向证明平台已启用。
- 仅启用 Claude/Codex 的项目不得生成 `.gemini`、`.pi`、`.kimi-code` 或 `.kiro` 根目录。
- 回归测试同时覆盖部分消费者、全部共享消费者和 dogfood 二次更新零变化。

## Acceptance Criteria

- [x] D01-D15 均有代码证据和明确归类；真实设计冲突包含方案比较、推荐意见和用户确认，纯机械重基线项包含准确失配原因与验证要求。
- [x] 61 条预检失败均映射到明确决策或纯机械重基线步骤，没有遗漏。
- [x] 新平台和 Pi `.pi/skills -> .agents/skills` 迁移等隐性冲突已纳入设计。
- [x] 共享 `.agents/skills` 不会把 Gemini/Pi/Kimi 等未启用消费者误判为逻辑平台或创建其私有目录。
- [x] 明确哪些上游能力完整吸收、哪些与 Flower 合并、哪些继续由 Flower 独占。
- [x] `prd.md` 完成收敛整理，不保留已解决的临时问题或重复结论。
- [x] 创建完整的 `design.md`、`implement.md` 和真实 `implement.jsonl` / `check.jsonl`。
- [x] Codex config/hook/route 对 `auto` 的解释一致，且组合断言可发现语义回归。
- [x] 跨版本 dry-run 能在沙箱内预演升级后 Plugin replay；真实 replay 失败会自动恢复升级前受管状态并报告恢复证据。
- [x] 专用 `trellis-check-all` agent 覆盖所有声明支持的平台和 channel；可写 `trellis-check` 拒绝 Check-All 意图。
- [x] 平台 dispatch 由结构化清单驱动并通过 schema、覆盖、目标闭包和 compiled target 检查。
- [x] final progress 同步成功后任务保持活动且状态为 `completed`，finish-work 归档后才移出活动树；progress push 失败、partial/commit-only 不得误完成。
- [x] 最新 `brief.md` 已展示并得到用户后续明确批准，才允许恢复实现。

## Out of Scope

- Trellis `0.7.0-beta.*` 的兼容性和升级决策。
- 在最终 Brief 批准前修改 Flower-Trellis 产品代码或 Patch 内容。
- 发布新的 Flower-Trellis npm 版本、创建标签或推送远端。
