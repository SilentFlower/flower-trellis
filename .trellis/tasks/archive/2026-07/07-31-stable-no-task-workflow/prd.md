# 为 No-Task 增加稳定完成流程

## Goal

把 `no_task` 下的 `direct_edit` 从一次性意图判断提升为可持续、可恢复、可验证的正式工作流。用户明确“不走 task”后，同一事项的后续“下一步”“继续”“走 Trellis 流程”“检查”“提交”等请求应沿稳定完成链推进，不得因为关键词重新补建 task 或临场拼接步骤。

## Background

- `srm` 的 Codex 会话 `019fb5e1-f67b-7c21-80b1-2ab98b51afd5` 先按用户要求完成无任务快速修改，随后把“走 Trellis 流程”误判为显式任务规划。
- 误建任务使用了普通 `task.py create`，用户再次要求不走任务后只能手工移入回收站，再用 `task.py finish` 清理 stale session 指针。
- 清理后 Check-All、Update-Spec、Push 可以在 `task=N/A` 下继续，但流程依赖 Agent 临场推断，缺少稳定的状态和下一步契约。
- 当前 Request Triage 和 `[workflow-state:no_task]` 允许 `direct_edit`，但 Phase 2.1 又规定实现必须存在 `in_progress` task，形成规则断层。
- 现有 `pre_check_state.py` 已提供 session 隔离、compact/resume 恢复、原子 JSON 写入和与其它 runtime 字段共存的实现模式，可作为无任务状态持久化的参考。

## Requirements

### R1. 无任务执行状态

- 所有最终路由为 `direct_edit` 的无任务修改都进入稳定完成链，包括 Agent 自动判断的低风险直接修改，以及用户明确选择“不走 task”“直接做”的场景。
- 确定 `direct_edit` 路由后，立即为当前 session 和当前事项记录 `mode=untracked`、`stage=inspect` 状态。
- 首次实际文件修改前捕获 dirty baseline，并把阶段切换为 `implement`；纯讨论和只读排查不得伪装成已开始实现。
- 状态至少能表达当前事项范围、开始时 dirty baseline、当前阶段和最近一次有效工作流切换。
- 同一 session 的 compact/resume 必须恢复该状态；不同 session 不得继承。
- 状态写入必须保留 session runtime 中的 `current_task`、route、auto-loop、pre-check 等其它字段，并采用现有原子写入约束。

### R2. 稳定完成链

- 无任务工作流的标准链路为：意图识别/排查 -> 开发前规范加载 -> direct edit -> 定向验证 -> Check-All -> Update-Spec -> Push -> done。
- direct edit 首次完成定向验证后，默认在同一流程进入 Check-All，不得把检查描述为可选下一步。
- 用户明确“先不检查”“继续改”时允许写入 session 级 hold 并暂停；“下一步”“可以检查了”“提交”“部署”等继续语义清除 hold 后进入 Check-All 或后续完成链。
- Check-All 后的停止、继续 Update-Spec 和 Push 条件复用现有 Interactive Post-Check Stop Gate，不为无任务模式放宽。

### R2.1 执行路由

- `no-task` 只表示不创建任务材料和任务进度，不得隐式覆盖用户保存的 implement/check 执行偏好。
- 无任务事项不读取或写入绑定 task path 的 session `route_decisions`，也不需要把 untracked work item 伪装成 task route scope。
- 无任务 implement/check 在每次进入对应阶段时直接读取并校验 `.trellis/.route-prefs.tmp` 中的个人默认；task 工作流继续保留现有 session runtime -> prefs -> auto-loop 解析顺序。
- `route_state.py` 应提供不依赖 current task 的偏好读取/写入入口，复用现有 mode 归一化、合法值校验和原子写入逻辑，避免主 Agent 直接解析文本。
- 对应 target 没有保存偏好时，展示现有 inline/sub-agent 选择；“仅本次”只作用于当前 implement/check 调用，不写 session route，“保存默认”只写入 `.trellis/.route-prefs.tmp`。
- 不得根据平台名称或 `codex-mode` 静默猜测无任务执行模式。
- untracked sub-agent dispatch 必须注入 work item id、用户请求摘要、事项范围、dirty baseline、当前阶段、已完成验证和相关项目规范；不得伪造 Active task 或要求不存在的 task JSONL。
- untracked 工作切换为正式 task 后，清理 untracked 状态；新 task 按现有 `trellis-route` 规则重新解析 task-scoped route，不迁移或伪造旧 task route 决策。
- `Check-All`、`trellis-update-spec` 和 `trellis-push` 必须继续支持 `task=N/A`，但不得降低各自的检查、确认和 Git 安全门禁。
- 无任务链路不创建 PRD/Brief，不运行 `task.py start`，不写任务进度，不执行任务归档。
- Check-All 有问题、部分验证或实质剩余风险时，仍按现有交互停止门禁处理；用户确认后才能继续下游步骤。

### R3. 后续请求继承

- Agent 自动路由的低风险 `direct_edit` 与用户显式选择的无任务修改使用相同的阶段推进和恢复语义。
- 同一 session 最多只能存在一个活跃的 untracked work item，不维护并行事项列表，也不得把多个事项静默合并到同一 baseline。
- 同一事项中的“下一步”“继续”“走 Trellis 流程”“走剩下流程”等表达默认推进当前无任务链路，不得解释为补建 task。
- “check/check-all/检查”进入 Check-All；“提交/push”仍先满足 Check-All -> Update-Spec -> Push 顺序。
- 只有用户明确表达“创建任务”“补建任务”“纳管到 task”等意图，才允许从无任务链路切换为任务规划。
- 无关只读咨询、解释或排查可以在不清理当前 work item 的前提下执行，但不得修改其阶段、范围、baseline 或验证证据。
- 当前 work item 未完成时，新的无关代码修改请求必须先停止并要求用户选择：完成当前事项、明确放弃状态跟踪但保留现有 dirty diff，或把当前事项纳管到 task；不得自动清理旧状态后开始新修改。
- 当前 work item 已清理后，无关新修改请求重新执行 Request Triage，并按需要创建新的单一 work item。

### R4. 范围扩大与安全边界

- 同类、可机械验证的范围扩大可继续沿无任务链路，并更新事项范围和当前 workspace 证据；首次修改前捕获的原始 dirty baseline 不得被覆盖。
- 当范围变为未知、存在未决设计，或触及权限、生产、数据库、迁移、凭据和其它独立安全边界时，必须暂停并重新路由；不得静默创建 task 或扩大授权。

### R5. 状态清理与切换

- 完成 Push、用户明确放弃、切换为正式 task、工作区恢复到 baseline 或状态失效时，应按明确规则清理无任务状态。
- 用户明确要求“创建任务”“补建任务”“纳管到 task”时，允许把当前 untracked diff 和原始 dirty baseline 原地接管到新 planning task。
- 接管过程必须保留当前代码，记录来源事项、原始 baseline、当前阶段和已完成验证；不得要求回滚、重复修改或先拆成一次无任务提交。
- 接管后仍需补齐对应规划材料、展示最终 Brief 并等待确认，再运行 `task.py start`；接管不等于自动获得实现或提交权限。
- 从无任务切换为 task 时，必须由正式 helper 原子完成状态转换，不允许手工删除任务目录或制造 stale pointer。
- 损坏、陈旧或与当前工作区不匹配的状态应安全降级为重新意图识别，不得覆盖其它 session runtime 数据。

### R6. 分发与一致性

- 真实源修改位于 `vendor/skill-garden/.trellis/0.6/` 的 owner Patch、helper、hook 和测试。
- 通过 `npm run sync` 同步到 `enhancements/0.6/`，并更新 Flower dogfood 产物。
- Fresh install、版本升级、Codex/Claude SessionStart、per-turn workflow-state 注入和选择性 Bundle 安装必须保持一致。
- 所有支持 `trellis-route` 的平台都必须获得一致的 untracked route 语义；平台不支持兼容 sub-agent 时仍按现有 route fallback/阻塞规则处理，不得静默改成 inline。
- 不能只修改部署后的 `.trellis/workflow.md`。

## Out of Scope

- 不改变 task planning、Brief review、`task.py start` 和任务归档的现有门禁。
- 不放宽 Check-All、Update-Spec、Push 的安全检查和用户确认要求。
- 不把无任务事项写成轻量 task，也不为每次 direct edit 生成 PRD。
- 不在本任务中重构无关的 MR 创建或 GitLab 发布流程。

## Acceptance Criteria

- [ ] Agent 自动判断的低风险 `direct_edit` 和用户显式“不走 task”的修改都创建同一种 session 级 untracked 状态。
- [ ] 用户明确选择无任务后，在尚未修改文件时发生 compact/resume，仍能恢复 `untracked/inspect`，且不会声称已经实现。
- [ ] 首次实际文件修改前记录 dirty baseline 并进入 `implement`，后续范围和工作区漂移判断以该 baseline 为依据。
- [ ] direct edit 完成定向验证后默认自动进入 Check-All；用户明确暂缓时停止，后续“下一步”能恢复并继续。
- [ ] 保存为 sub-agent 的 implement/check 偏好在无任务事项中仍生效，保存为 inline 时也不会被强制 dispatch。
- [ ] untracked sub-agent 获得完整事项上下文，但不会读取或伪造不存在的 task artifacts。
- [ ] 无任务事项不会读取或污染 task-scoped `route_decisions`；切换到 task 后按现有任务路由重新解析。
- [ ] 无活动任务时可以通过正式 helper 安全读取、保存和清除 `.route-prefs.tmp`，非法或损坏值按 miss 处理。
- [ ] 无保存偏好时会展示执行模式选项；仅本次选择不产生 task/session route state，保存默认后后续无任务和任务流程都能读取。
- [ ] 用户明确“不走 task”后，完成 direct edit，再说“下一步”时进入 Check-All 或当前链路的下一阶段，不创建 task。
- [ ] 同一场景中用户说“走 Trellis 流程”时继续无任务完成链；只有明确“创建/补建任务”才切换到 task planning。
- [ ] compact/resume 后能恢复同一 session 的无任务事项和阶段，不同 session 不会误继承。
- [ ] 同一 session 已有活跃 untracked work item 时，无关只读请求可以正常回答且不改变状态；新的无关代码修改会被阻止，直到用户完成、放弃跟踪或纳管当前事项。
- [ ] 无任务 helper 拒绝创建第二个活跃 work item，且任何切换路径都不会静默合并两个事项的范围、baseline 或验证证据。
- [ ] 无任务链路能依次完成 Check-All、Update-Spec 和 Push，并在报告中明确 `task=N/A`。
- [ ] Check-All 发现问题、部分验证或剩余风险时仍停止，用户确认后才能继续。
- [ ] 状态损坏、事项不匹配或工作区漂移时安全回到 Request Triage，不破坏其它 runtime 字段。
- [ ] 显式切换为 task 时，现有 diff、baseline、阶段和验证证据被正式接管；仍经过规划、Brief 和 `task.py start` 门禁。
- [ ] 回归测试证明切换过程中不需要回滚或重复修改，也不会出现手工删除任务目录和 stale pointer 清理路径。
- [ ] Skill-Garden 真实源、`enhancements/0.6` 快照和 Flower dogfood 结果一致。
- [ ] Python helper/hook 测试、Patch consumer 回归、workflow walkthrough、fresh install 和 upgrade 回归全部通过。
