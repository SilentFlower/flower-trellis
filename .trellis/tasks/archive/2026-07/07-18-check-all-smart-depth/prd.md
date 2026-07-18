# 升级 Check-All 智能检查与 Auto-Loop 续跑

## Goal

保持 `trellis-check-all` 作为统一检查入口，由它根据用户最新意图、任务规划、实际 diff、风险信号和运行上下文，自动选择 light/full 检查深度；同时确保 running auto-loop 在检查后始终按 runner 的 `record + next` 协议续跑，不再被普通交互式停止边界带偏。

## Background

- 当前 Check-All 已存在“局部低风险路径 / 完整适用范围路径”的雏形，但判定条件只覆盖少量风险类型，没有稳定输出所选深度、置信度和原因。证据：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md` 的 `Step 0.3`。
- 当前 `trellis-route(target=check)` 的普通入口只选择 `check-all inline/subagent`，轻量 `trellis-check` 是显式请求才开放的隐藏逃生口。此次改造不把检查深度重新放回 route；route 继续只管理执行位置。
- workflow hub 已声明 running auto-loop 的 `record + next` 覆盖普通 Post-Check Stop Gate，但普通停止规则排在例外之前，而且高频 `in_progress` / `in_progress-inline` guard 重复了普通停止规则却没有 auto-loop 例外，模型仍可能错误停下等待用户。证据：`vendor/skill-garden/.trellis/0.6/overrides/workflow.md:105`、`vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`。
- auto-loop runner 已稳定使用 `run_check_all -> run_fix/run_recheck -> run_spec_update -> commit_only` 动作链；无需改名或让 Check-All 自己提交。证据：`vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py:737`、`:816`、`:1067`。
- 历史会话已出现“被 Check-All 普通停止边界带偏停住，用户提醒后才恢复 auto-loop”的实际问题。目标是消除错误停顿，而不是增加一条事后恢复话术。

## Requirements

### R1. Check-All 保持统一入口

- 普通 Phase 2.2、显式 `check-all`、最终检查和 auto-loop 的 `run_check_all` 继续进入 `trellis-check-all`。
- 用户显式请求“轻量检查 / light check”时也进入 Check-All，并设置 `requested_depth=light`；不得再由 route 直接派发顶层 `trellis-check`。
- Check-All 内部选择 `light` 或 `full`，不新增用户可见的独立 depth router。
- `trellis-route(target=check)` 继续只决定 inline/subagent；现有 route preference 和 runtime schema 不因检查深度选择而迁移。

### R2. 智能检查深度判定

- Check-All Step 0 必须综合：用户当前请求中的最新显式覆盖、当前任务及规划产物、实际 Git 变更范围、跨层/状态/发布/注入等风险信号、既有检查/修复循环。
- 用户明确说“简单检查 / 轻量检查”时选择 light；明确说“全面检查 / 最终检查 / 提交前检查”时选择 full。最新显式切换只影响当前检查请求。
- 显式 light 不能突破 hard-full 安全底线。命中安全、迁移、发布、持久化/schema、回滚或 full 修复重检等强信号时，Check-All 自动升级为 full，并记录 `requested_depth=light`、`effective_depth=full` 与升级原因。
- full 的强信号至少包括：复杂任务三件套、跨层或跨仓、公共 API/CLI 契约、schema/持久化/缓存状态、迁移/历史数据、权限/安全/资金、并发/时序/状态机、workflow/skill/hook 注入、安装/升级/发布、submodule/生成快照、已有 `CHK-*` 的修复后重检。
- light 只允许用于高置信局部低风险变更；文件数和增删行只能作为辅助信号，不能单独决定深度。
- 没有显式用户覆盖且无法高置信判断时，interactive 和 auto-loop 都默认 full 并直接继续，不增加机械确认。
- light 检查中发现新的强风险信号时允许单向升级为 full；同一轮不得静默从 full 降级为 light。
- 每次检查结果必须包含 `depth=light|full`、简短判定原因和未覆盖维度，便于用户和 auto-loop 审计。
- 高置信 light 检查通过即正式满足本轮检查门禁，不要求随后补跑 full。Interactive 可指向 Phase 3.3；auto-loop 可 `record ok -> next`。

### R3. 两种深度保持统一审计语义

- light/full 都保持 audit-only，不在检查阶段编辑代码、配置、测试或任务文档。
- light 复用 Check-All 的统一问题模型和 `CHK-*` 编号，只执行受影响规划条目、直接引用点、必要回归路径和完整性/规范验证。
- full 执行现有三件套实现、关键假设、完整性与规范三个维度。
- `trellis-check` 作为 Check-All 内部 light/Step 3 执行能力时，只返回检查证据和问题，不得自行修复、决定停止或向用户提问。

### R4. 运行上下文优先于普通停止边界

- Check-All 开始时先区分 `interactive` 与经过 runner/helper 验证的 `auto-loop`，不得只凭 session 摘要或自然语言声称正在 auto-loop。
- Interactive：输出统一报告后停止，等待用户选择修复范围或进入后续显式 workflow action。
- Auto-loop：普通 Post-Check Stop Gate 不适用；Check-All 必须把结果交回 runner，不展示普通修复菜单，也不等待用户确认下一个子任务。
- Auto-loop 无问题时 `record --result ok` 后继续 `next`；有问题时 `record --result failed`，由 runner 进入 `run_fix`；只有真实产品决策、越权或破坏性风险才 `record --result blocked`。
- “停止检查”在 auto-loop 中只表示当前检查动作返回 runner，不表示停止整个会话。

### R5. Auto-Loop 协议保持兼容

- 保留 `run_check_all`、`run_fix`、`run_recheck`、`run_spec_update`、`commit_only` 动作名称和既有 fix/recheck 预算。
- `run_check_all` 表示调用 Check-All 统一入口，不再保证一定执行 full。
- auto-loop `start` 新增运行级 `check-depth=auto|light|full`，默认 `auto`；该值写入 runner state，并在压缩恢复、多任务和 fix/recheck 中保持稳定。
- 升级前已存在且缺少 `check_depth` 的 running state 按 `full` 兼容，避免旧 run 在恢复时静默降低检查深度。
- `check-depth` 只控制检查深度；`--route-check check-all-inline|check-all-subagent` 继续只控制执行位置。
- Check-All 不读取或扩大 commit-only 授权，不生成普通 push 确认；提交仍由 runner 验证后调用 `trellis-push` 内部 commit-only。
- auto-loop 记录中应保留本轮实际 depth 和判定原因，具体承载字段在设计阶段确定。

### R6. 停止门禁去冲突

- 把普通停止规则明确限定为 interactive，例如命名为 `Interactive Post-Check Stop Gate`。
- Auto-Loop Return Gate 必须在 Check-All 和高优先级 workflow hub 中先于普通停止规则表达。
- `in_progress` / `in_progress-inline` 高频 guard 必须包含同样的 auto-loop 例外，不能依赖 hub 深处的单条补充说明。
- Check-All、workflow hub、workflow-state guard、route dispatch 文案和 auto-loop instruction 不得再形成“先停、再恢复”的冲突。

### R7. 修复与重检稳定性

- Check-All 发现问题后的交互式修复仍由用户一次选择范围；auto-loop 仍由 runner 自动进入 `run_fix`。
- 修复后的 `run_recheck` 必须复用原检查深度，或在出现新增强风险时升级；不得从 full 自动降级为 light。
- 原有问题 ID 在同一修复/重检循环中保持稳定。

### R8. 0.6 源与分发同步

- 先修改 `vendor/skill-garden/.trellis/0.6/` 源，再运行 flower 快照同步。
- `.agents`、`.claude`、`enhancements/0.6` 和当前 dogfood `.trellis/workflow.md` 的适用副本保持一致。
- 不改变 0.5 / old 行为，除非实现期间发现共享代码必须兼容并单独记录证据。

## Acceptance Criteria

- [ ] 普通检查、显式 `check-all` 和 auto-loop `run_check_all` 都只调用 Check-All 统一入口。
- [ ] 给定局部低风险 diff，Check-All 选择 light，并输出 depth、原因和 N/A/未覆盖维度。
- [ ] 高置信 light 通过后正式满足检查门禁，不额外补跑 full。
- [ ] 给定任一强风险信号，Check-All 选择 full 并执行三个适用维度。
- [ ] 用户在当前请求中显式切换简单/全量后，最新意图覆盖自动判断。
- [ ] 显式 light 命中 hard-full 信号时自动升级 full，并保留 requested/effective depth 审计证据。
- [ ] light 检查发现强风险时升级为 full；full 修复重检不会降级。
- [ ] interactive Check-All 完成后按普通停止边界等待用户，不自动 commit/push/finish-work。
- [ ] running auto-loop 检查通过后自动 `record ok -> next`，不输出普通修复菜单，不等待用户确认。
- [ ] running auto-loop 检查失败后自动 `record failed -> next(run_fix)`；真实阻塞才等待用户。
- [ ] auto-loop 后续仍按 `run_recheck -> run_spec_update -> commit_only` 推进，原授权和预算不变。
- [ ] auto-loop `check-depth=auto|light|full` 可审计、可恢复，并与 route-check 执行位置独立。
- [ ] `trellis-check` 在 Check-All 内部调用时保持 audit-only，不独立停止或修改工作区。
- [ ] workflow hub、两个 in-progress state guard、Check-All skill 和 auto-loop instruction 的停止/续跑语义一致。
- [ ] vendor 源、agents/claude 副本、enhancements 快照和 dogfood 注入结果通过一致性与幂等验证。
- [ ] 新增自动化场景覆盖 light/full 判定、用户覆盖、风险升级、interactive stop、auto-loop pass/fail/blocked 和多子任务无确认续跑。

## Out of Scope

- 不改变 implement 的 inline/subagent 路由逻辑。
- 不让 Check-All 执行 commit、push、finish-work 或任务归档。
- 不调整 auto-loop 的 commit-only 安全归属、队列模型或默认三轮 fix/recheck 预算。
- 不把 Check-All 的核心语义判断整体改写成纯脚本；脚本只适合采集确定性证据和验证 runner 状态。
