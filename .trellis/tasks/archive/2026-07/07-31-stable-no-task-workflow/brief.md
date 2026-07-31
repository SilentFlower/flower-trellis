# Brief — 为 No-Task 增加稳定完成流程

## Goal

- 把所有 `direct_edit` 无任务修改升级为 session 级、可恢复、可验证的稳定完成链，使同一事项的“下一步”“继续”“走 Trellis 流程”“检查”“提交”等请求继续当前链路，而不是误建 task 或临场拼接步骤。

## Scope

- 新增 `untracked_flow.py`，在 session runtime 中维护单一活跃 work item、`inspect -> implement -> check -> spec -> push` 阶段、事项范围、原始 baseline、workspace fingerprint 和最小验证证据。
- direct_edit 路由后立即创建 `inspect` 状态，首次文件写入前捕获根仓、递归 submodule 和配置独立 Git package 的多仓 baseline；后续修改不覆盖原始 baseline，并使过期下游证据失效。
- 同一 session 最多一个活跃 untracked work item。无关只读请求可以穿插；新的无关代码修改必须先完成、明确放弃状态跟踪但保留 dirty diff，或把当前事项纳管到 task。
- 无任务 implement/check 直接通过 `route_state.py` 读取 `.trellis/.route-prefs.tmp`；不读取或写入 task-scoped `route_decisions`。没有偏好时保留“仅本次 / 保存默认”选择。
- 扩展 pre-check hold，使其可绑定 task 或 untracked subject；保留旧 task hold 兼容。
- 在 `task_intent.py` 增加原子 adoption 事务，把现有 diff、原始 baseline、阶段和证据接管到新 planning task；接管后仍经过三件套、Brief 和 `task.py start`。
- 新增 `untracked` workflow breadcrumb，更新 Request Triage、Phase 2/3、Codex/Claude SessionStart、相关 Skill 和 implement/check agent；sub-agent 使用 `Untracked work: <id>` 与显式上下文，不伪造 task artifacts。
- 修改 Skill-Garden 0.6 真实源、Patch、Bundle 和 helper 分发，运行 `npm run sync`，刷新 compiled targets，并验证 fresh install、upgrade、selective Bundle 和 Flower dogfood 幂等。

## Non-Goals

- 不改变 task planning、Brief review、`task.py start`、任务进度或归档门禁。
- 不放宽 Check-All、Update-Spec、Push 的检查、确认和 Git 安全要求。
- 不把无任务事项包装成轻量 task，也不为 direct edit 生成 PRD/Brief。
- 不支持同一 session 并行维护多个 untracked work item，不自动合并事项或 baseline。
- 不重构无关的 MR 创建、GitLab 发布或软件包 release 流程，也不自动 commit、push、打 tag 或发布 npm。

## Key Context

- 原始问题来自 `/root/project/srm` 会话 `019fb5e1-f67b-7c21-80b1-2ab98b51afd5`：无任务修改完成后，“走 Trellis 流程”被误判为创建 task，随后只能手工删除目录和清理 stale session 指针。
- 真实源是 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/`、compiled targets 和当前 Flower dogfood 均为同步/生成结果，禁止单独手改。
- `pre_check_state.py` 提供 session 隔离和原子 runtime 写入模式；`route_state.py` 已分离个人 pref 与 task runtime decision；`task_intent.py` 已拥有 planning task 创建和失败补偿边界。
- 多仓 baseline 不能只看根仓 porcelain；需要覆盖子仓内部状态，并用内容/index 指纹区分“开始前已 dirty”与“工作期间再次修改”。已有 staged 内容作为 baseline 保留，冲突、未完成 Git 集成或证据读取失败才阻止首次写入。
- Workflow breadcrumb 只提供当前状态和下一跳，Check-All、Update-Spec、Push 的完整规则继续由各自 Skill 持有，避免 Hub 复制 owner 逻辑。
- session runtime 损坏、workspace drift、route pref 非法或 adoption 失败均必须安全停止/降级，不覆盖用户 dirty diff，也不破坏 runtime 其它字段。

## Acceptance

- 自动判断和用户显式选择的 direct_edit 都创建同一种 untracked 状态；compact/resume 能恢复正确事项和阶段，不同 session 不串状态。
- 首次修改前记录完整多仓原始 baseline；后续范围扩大只更新 scope/current fingerprint，新的修改会清除过期 Check-All/Update-Spec 证据。
- 定向验证后默认进入 Check-All；用户明确暂缓时可恢复，“下一步”或“走 Trellis 流程”继续现有完成链且不会创建 task。
- 保存的 inline/sub-agent 偏好在无任务流程生效；无任务不会污染 task-scoped route decision，sub-agent 获得完整上下文但不读取或伪造 task JSONL。
- 单活跃 guard 能允许无关只读请求、阻止第二个无关写事项，并要求用户在完成、放弃跟踪或纳管之间明确选择。
- 无任务链能以 `task=N/A` 完成 Check-All、Update-Spec 和 Push，且所有失败、部分验证和风险确认门禁保持不变。
- adoption 保留现有 diff、baseline、阶段和证据，各失败点可补偿恢复，不需要回滚或重复修改，也不会产生手工删除 task/stale pointer 路径。
- Python helper/hook、JS Patch consumer、workflow walkthrough、fresh install、upgrade、selective Bundle、compiled targets 和 dogfood 回归通过；vendor 源、snapshot 和生成目标一致，第二次应用 unchanged。

## Next Step

- 用户确认本 Brief 后运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-stable-no-task-workflow`，随后按 `trellis-route(target=implement)` 读取个人执行偏好并进入实施。
