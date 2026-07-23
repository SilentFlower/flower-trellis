# 修复 Workflow Gate 迁移兼容性回归

## Goal

修复 Workflow Hub Gate 原生所有权迁移造成的全部已确认入口可达性回归，并把测试从“owner 文字存在”提升为“真实状态、真实平台和真实动作链下 owner 可达”，确保缩短 Hub 不会牺牲原有能力。

## Background

- 最近的 Gate 迁移把 Hub 中 13 个完整 Gate 收敛到 Phase、workflow-state、Skill、Hook 或 helper，并显著降低了 SessionStart 上下文体积。
- 首轮可达性审计确认以下三项被改窄：
  - `CHK-001`：Project Knowledge Discovery 从全局决策边界缩到 `trellis-before-dev`，`inspect`、`direct_edit` 和 `workflow_action` 可能绕过。
  - `CHK-002`：Active Task Scope Guard 只进入 `in_progress` state，`planning` task 收到无关请求时没有相同隔离。
  - `CHK-003`：Task Progress Recovery 的 owner 写成 `trellis-push`，但 `trellis-continue` 和 SessionStart 恢复入口不读取 `task_progress.py`。
- `CHK-004`：现有测试只断言 marker、heading 和关键字符串存在；行为基线没有覆盖上述三个入口场景，因此完整测试和 Patch conflict 都会错误通过。
- 严格复查其余 Workflow Gate 后又确认以下回归：
  - `CHK-005`：Brainstorm Gate 只检查 artifact 存在，未验证验收标准可测试、关键决策已收敛和剩余问题真实可阻塞。
  - `CHK-006`：auto-loop 刷新 brief 后可直接启动任务，没有展示当前 brief 并等待显式确认的握手。
  - `CHK-007`：Routing Gate 的高频入口和 route 返回结果没有保证实现完成后回到 Phase 2.1 Pre-Check，可能停在局部验证。
  - `CHK-008`：用户直接要求 push 时，`trellis-push` 没有检查当前 Check-All 后是否已完成 Update-Spec。
  - `CHK-009`：Flower 自定义 Gate Skill 只分发到 `.agents`/`.claude`，其余平台的原生 skill、Update-Spec 和 Finish-Work 入口可能保持旧行为。
  - `CHK-010`：现有测试未覆盖上述语义握手、direct push 和平台矩阵，导致跨平台旧入口仍能通过。
- `0.6.0-beta.0` 已完成只读 dry-run，但没有 release commit/tag；发布保持暂停，直到本任务完成并重新走发版确认。

## Requirements

### R1. 恢复 Project Knowledge Discovery 全局决策边界（CHK-001）

- 在为非平凡项目工作选择方案前，只要项目本地 SOP 或约定可能改变做法，就必须运行 `spec_router.py` 并读取适用候选。
- 必须覆盖 Trellis/workflow/config/hooks、CLI 行为、release/publish/deploy/tag、Git 历史动作、数据/迁移/回滚、跨层设计、生成物、安装和同步链路。
- 触发粒度是一个用户意图、阶段或决策边界，不是每条命令前重复运行。
- 纯问答、简单只读检查、打开本地工具和轻量修改默认跳过，除非项目约定可能影响正确做法。
- `workflow_action` 只有在用户明确指定 Trellis capability 或存在准确对应能力时才直接加载该 Skill；项目特有流程动作必须允许先由知识发现命中 SOP，再按 SOP 执行。不得把“发 beta”误解释为只生成上线操作单的 `trellis-release`。

### R2. 覆盖所有 active task 状态的 Scope Guard（CHK-002）

- 只要当前 session 存在 active task，无关的新实现请求都不得静默归入该任务。
- `planning`、`planning-inline`、`in_progress` 和 `in_progress-inline` 必须具有等价的一跳门禁。
- 请求不属于当前 title/brief 时，在 task route、artifact 归属或文件编辑前停止，并根据用户意图选择：创建新任务、明确纳入后先更新 artifacts、或明确不跟踪且不复用当前 task/progress。
- 自然语言归属判断保留在全局 policy owner；`task_intent.py` 只执行已判定的 create/discard/current-task 安全边界。

### R3. 恢复 Task Progress 的跨会话读取入口（CHK-003）

- `trellis-push` 继续负责业务 push 后写入当前任务 progress；恢复读取不再由 push Skill 假装拥有。
- `trellis-continue` 在判断恢复阶段前运行 `task_progress.py status --json`，并在存在进度时只展示 `partialStep`、`nextStep` 和必要的 `notes`。
- 无 active task 但存在健康候选时，只 relay helper 的 summary/candidates 并建议 rebind；不得自动 rebind、推断 workflow phase、恢复旧 push mode 或提交编排。
- helper 的 invalid candidates、scan warnings、结构化错误和只触碰 `task.json.progress` 的边界保持不变。

### R4. 唯一所有权与上下文预算

- Project Knowledge Discovery 和 Active Task Scope Guard 的 primary policy owner 调整到全局 `Request Triage`；runtime owner 分别保持 `spec_router.py` 和 `task_intent.py` 安全边界。
- Task Progress Recovery 的 primary policy owner 调整为 `trellis-continue`；`task_progress.py` 是 runtime owner，`trellis-push` 只拥有写入动作。
- Workflow Hub 只更新 owner 索引和必要顺序，不恢复完整 Gate 正文。
- workflow-state、`trellis-before-dev` 和 `trellis-brainstorm` 只保存当前状态需要的一跳入口，不复制完整 policy。
- 不通过提高 AI context budget 阈值解决新增内容；必须用 owner 去重控制最终体积。

### R5. Patch 与分发一致性

- 先修改 `vendor/skill-garden/.trellis/0.6` 的真实源；所有 0.6 workflow/skill 变更继续通过 Patch Engine 表达。
- 复用可原位升级的 operation ID；只有 `trellis-continue` 尚无对应 recovery Patch 时才新增目标明确的 Patch operation。
- 更新相关 Bundle，保证精细安装不会得到只有 owner 指针、缺少 `spec_router.py` 或 `task_progress.py` 的不完整流程。
- 通过 `npm run sync` 同步 `enhancements/0.6`，再应用到当前 dogfood 的 `.trellis/workflow.md`、`.agents` 和 `.claude` 最终副本。

### R6. 行为可达性测试（CHK-004）

- 保留静态 owner 唯一性、Hub 去重、marker 和 context budget 断言。
- 新增至少以下回归场景，并确保旧实现会失败：
  - 无任务“发 beta”：先 Project Knowledge Discovery，再按命中 SOP/准确 capability 路由。
  - 无任务非平凡 inspect/direct edit：项目约定可能改变做法时仍能进入知识发现。
  - planning task 收到无关实现：在 artifact 更新、route 或编辑前停止。
  - in-progress task 收到无关实现：继续保持相同行为。
  - `trellis-continue` 恢复：先读取 task progress，再结合 status/artifacts 决定下一 Phase。
  - 无 active task 的 progress candidates：只建议 rebind，不自动改 session/task。
- `conflicts.json` 必须断言最终产物的 owner、状态入口和顺序，而不只断言某个 Skill 文件含关键字。

### R7. 发布边界

- 本任务不生成 release commit/tag，不推送发布 tag，不触发 npm/GitHub 发布。
- 修复、Check-All、Update-Spec 和 Trellis Push 完成后，重新获取远端/npm 状态，并重新展示 `0.6.0-beta.0` dry-run 供用户确认。

### R8. 恢复 Brainstorm 与 Task Brief 语义门禁（CHK-005、CHK-006）

- planning task 在启动前必须验证：验收标准可测试、范围与非目标明确、关键实现决策已收敛、仓库可回答的问题已经研究、剩余问题确实需要用户决策。
- auto-loop 不得只凭 `prd.md`、`design.md`、`implement.md` 或 `brief.md` 存在就判定 ready；语义审查结果必须绑定当前 planning artifacts 内容，artifact 变化后自动失效。
- brief 缺失或过期时先刷新；刷新后必须展示当前 brief 并等待用户显式确认，确认结果必须绑定当前 brief 与 authoritative artifacts。
- auto-loop 启动授权不等于 brief 确认；只有内部 commit-only 预授权保持原有例外。

### R9. 恢复 Routing Pre-Check 与 direct push 顺序（CHK-007、CHK-008）

- `trellis-route(target=implement)` 必须明确：实现和必要局部验证完成后回到 Phase 2.1 completion contract，再进入 Pre-Check，不得直接结束当前实现回合。
- in-progress 高频 state 只保留回到 Phase 2.1 owner 的一跳指针，完整停止/继续策略仍由 Phase 2.1 唯一拥有。
- 用户直接要求普通 push 时，`trellis-push` 必须验证当前有效 Check-All 之后存在当前有效 `spec_update_result`；缺失或过期时先进入 `trellis-update-spec`。
- auto-loop 内部 commit-only 路径继续使用既有明确预授权，不得被交互式 Update-Spec 门禁误伤。

### R10. 全平台 Gate 分发与原生入口覆盖（CHK-009）

- Flower enhancement Skill 必须复制到所有已安装平台的原生 skill root；仅在没有识别到任何平台时保留 Claude fallback。
- 平台 root 映射必须集中定义并由安装检测、应用、卸载和 stale-managed-root 处理共同复用，避免模块间平台列表漂移。
- Update-Spec 与 Finish-Work Patch 必须覆盖 17 平台的真实原生入口，包括 skill、command、workflow、prompt 和 Gemini TOML 形态。
- 选择性安装必须自包含；任何平台从其原生入口进入时都不能绕过新的 Gate owner。

### R11. 语义与平台矩阵测试（CHK-010）

- 新增 planning semantic readiness、artifact 变更失效、brief 刷新后等待确认、确认后启动的状态机场景。
- 新增 implement route 返回 Pre-Check、direct push 先 Update-Spec、auto-loop commit-only 不受影响的场景。
- 新增全部平台 skill root 的复制、检测、卸载和真实原生 Patch target 测试，至少包含 Kiro-only 与 17 平台矩阵。
- 测试必须读取最终应用产物，不能只读取 `.agents` canonical source 或 Patch marker。

## Acceptance Criteria

- [ ] `Request Triage` 包含 Project Knowledge Discovery 和 Active Task Scope Guard 的完整全局 policy，且没有第二份完整 owner。
- [ ] 最终 `workflow-state:no_task` 对非平凡 workflow action 保留 knowledge discovery -> SOP/准确 capability 的一跳顺序。
- [ ] planning 与 in-progress 的两个平台变体都在无关请求进入 artifacts/route/edit 前执行 Active Task Scope Guard。
- [ ] `trellis-continue` 在 Phase 判断前调用 `task_progress.py status --json`，仅 relay 允许的恢复字段和候选提示。
- [ ] Hub owner 索引准确指向新的三个 primary owner/runtime owner，旧错误 owner 字面量不再出现。
- [ ] `trellis-before-dev`、`trellis-brainstorm`、workflow states 和 `trellis-push` 不复制上述完整 policy。
- [ ] `python3 ./.trellis/scripts/spec_router.py "beta release publish tag changelog npm"` 高置信召回发版 SOP。
- [ ] 新的 reachability tests 在旧实现上至少捕获 CHK-001、CHK-002、CHK-003，当前静态测试不能再单独构成通过条件。
- [ ] `intent-routing`、`trellis-continue`/progress 相关精细 Bundle 安装后具备完整 policy、breadcrumb 和 runtime 脚本。
- [ ] `npm run sync` 后 vendor 与 `enhancements/0.6` 一致；当前 dogfood 连续应用两次时第二次修改数为 0。
- [ ] planning 启动前有内容绑定的语义就绪结论；brief 刷新后必须展示并等待内容绑定的显式确认。
- [ ] implement route 完成后回到 Phase 2.1 Pre-Check；普通 direct push 缺少当前 Update-Spec 结果时不能进入 Git 提交。
- [ ] Flower Gate Skill 在所有已安装平台原生 skill root 可达，Update-Spec/Finish-Work 的 17 平台原生入口均应用相同策略。
- [ ] Kiro-only 和全平台真实安装矩阵不再生成仅 `.claude` 可用、原生入口未修复的结果。
- [ ] `npm test`、Patch conflict、strict context budget、snapshot、语法检查和 `git diff --check` 全部通过。
- [ ] 没有 release commit/tag，npm `beta` 仍保持 `0.5.0-beta.7`，直到用户重新确认发版。

## Out Of Scope

- 不修改 `spec_router.py` 的匹配算法、输出结构或文档扫描范围。
- 不新增平台 Hook 自动执行 `spec_router.py`。
- 不恢复 Hub 的完整 Gate 正文，不新增通用 Gate controller 或持久化 Gate 状态。
- 不改变各平台上游 CLI 的原生文件格式；只通过 Patch Engine 和集中分发映射恢复现有能力。
