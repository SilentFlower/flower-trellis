# Workflow Hub Gate 原生流程融合

## Goal

通过现有 Patch Engine 把 Workflow Hub 中全部 13 个 Gate/Guard 下沉到 Trellis 原生生命周期入口，使规则由对应 phase、workflow state、skill、hook 或 helper 直接拥有和执行。

迁移后 Hub 只保留轻量 owner 索引与必要的跨阶段顺序，不再作为完整规则正文的唯一来源。

## Background

当前 Hub 同时保存请求路由、任务规划、检查、提交、auto-loop、归档和进度恢复等完整规则。部分规则已经在 `task.py`、`route_state.py`、`auto_loop.py`、`trellis-check-all`、`trellis-push` 等原生入口中实现，Hub 仍保留重复正文，形成所有权漂移和高频上下文膨胀。

上一版把“深度集成”解释为新增 `gates.json`、Gate loader、资产闭包校验和 provenance。该方案只验证安装完整性，没有把 Gate 行为融入 Trellis 原生流程，已整体回滚并保存在 Git stash 中，不作为本任务基础。

## Decisions

- Hub 中全部 13 个 Gate/Guard 均纳入迁移范围。
- 不新增 Gate Engine、Gate catalog、Gate provenance 或平行 workflow controller。
- 能由本地状态确定性判断的条件下沉为 runtime enforcement；需求清晰度、任务语义归属等产品判断保留为原生 owner 内的 policy contract。
- 正常用户路径、phase 顺序和确认次数保持兼容；只阻断原本就不合法但此前主要依赖提示词避免的路径。
- 0.6 的最终文件修改继续全部通过 Patch Engine；Skill-Garden 是真实源，Flower 只负责同步快照和平台扩展。

## Requirements

### R1. 唯一所有权

- 每个 Gate 必须有一个 primary policy owner 和零到一个 runtime owner。
- 完整规则只存在于 primary owner；state 和 Hub 只保留一跳动作或权威入口。
- 已迁移 Gate 的旧 Hub 正文必须通过 Patch `replace/remove` 删除，禁止“旧正文保留 + 新正文追加”。

### R2. 原生流程融合

- Request Intent、Active Task Scope 进入请求入口、`trellis-start`、对应 workflow state 和 `task_intent.py`。
- Brainstorm、Task Brief 进入 Phase 1、`trellis-brainstorm`、`trellis-task-brief` 和 `task.py start`。
- Project Knowledge Discovery 由 `spec_router.py` 提供确定性发现，Phase 1/2 的 owning skill 负责触发。
- Flower Update Confirmation 进入 SessionStart update hook 与 Flower CLI 更新命令。
- Routing 进入 Phase 2、`trellis-route` 和 `route_state.py`。
- Auto-Loop Return 与 Interactive Post-Check Stop 进入 `trellis-check-all`、Phase 2.2 和 `auto_loop.py`。
- Code Commit、Auto-loop Commit-only、Bookkeeping、Task Progress 分别进入 `trellis-push`、`trellis-auto-loop`、`trellis-finish-work`、`task_progress.py` 与相关 Git helper。

### R3. Runtime Enforcement

- `task.py start`、route helper、auto-loop runner、push/finish helper 等只对可证明的状态执行硬阻断。
- runtime error 必须返回稳定、可测试的结构化状态或退出码，并保持目标文件/Git 状态不变。
- 不为 AI 意图判断引入新的确认记录、人工布尔状态或容易卡死的全局 Gate 状态。

### R4. Hub 收敛

- Hub 只保留 owner map、少量跨阶段优先级和权威入口。
- Hub 不复制 skill 步骤、helper schema、交互模板、错误矩阵或 Git 细节。
- 最终 workflow control、Phase summary、SessionStart 和 state 总量必须满足现有 context budget。

### R5. 兼容与发布

- 使用现有 Patch/Bundle schema、selector、baseline、marker、preflight 和首次备份机制。
- 保持现有 Patch/operation ID；需要移动内容所有权时优先原位升级，避免叠加第二份 marker。
- JS/Python Patch consumer 对同一 catalog 的最终文件保持一致。
- full 与现有精细 alias 都必须得到自包含的 owner 规则，不得依赖未安装 skill。

### R6. 原有冲突收敛

- 迁移前必须盘点上游 Trellis workflow、现有 Skill-Garden Hub/phase/state/skill Patch、Flower 平台 Patch 和 helper runtime 中的同义、矛盾或重复规则。
- 冲突不能只记录 warning；必须为每项冲突选择唯一权威 owner，并通过 `replace/remove`、Patch 合并或 runtime 边界修正消除旧实现。
- 上游原有行为与强化规则冲突时，优先保留上游结构和非冲突内容，只替换完成目标所需的最小 section/body。
- `conflicts.json` 必须断言已删除冲突签名不再出现、唯一 owner marker 存在且跨阶段顺序正确，防止后续上游升级把旧规则带回。
- Patch operation/target 重叠、selector/baseline 漂移、精细 Bundle 缺 owner、Hub/state/skill 重复和 runtime/policy 授权不一致都属于必须解决的冲突。

## Acceptance Criteria

- [ ] 13 个 Gate 都在 owner 矩阵中有唯一 primary policy owner，确定性 Gate 有明确 runtime owner。
- [ ] Hub 不再包含 13 个 Gate 的完整正文，只保留轻量索引和跨阶段短边界。
- [ ] `task.py start`、route、auto-loop、push、finish-work、task progress 的非法确定性状态均有硬阻断测试。
- [ ] policy-only Gate 的完整规则存在于实际执行该动作的 phase/skill/state 中。
- [ ] 正常 full、`task-intent`、`trellis-route`、`trellis-check-all`、`trellis-push`、`trellis-auto-loop`、`finish-work` 和 update 流程与迁移前行为兼容。
- [ ] Patch 漂移、重复 marker 或缺失 owner 证据在写盘前失败。
- [ ] 原有同义或矛盾规则均有冲突清单、处理决策和最终产物正反断言；不存在“新 owner 生效但旧规则仍可触发”的双轨行为。
- [ ] 最终 workflow、Phase summary、SessionStart 和 states 不超过现有 review ceiling，Hub/控制面体积应下降或有明确抵消证据。
- [ ] JS/Python 测试、Patch conflict、strict context budget、源/快照一致性和两次 dogfood 全部通过；第二次 Patch 修改数为 0。

## Out Of Scope

- 不新增 task status、workflow phase 或通用状态机。
- 不把所有 AI 产品判断强行编码为脚本规则。
- 不修改 `node_modules` 中的上游 Trellis 源；最终 Trellis 产物通过 Patch Engine 演进。
- 不恢复 0.5/old 专用注入器，也不新增 Patch Engine 之外的写入通道。
