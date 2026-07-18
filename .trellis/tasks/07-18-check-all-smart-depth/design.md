# Technical Design

## Overview

本改造保持 `trellis-check-all` 为唯一检查门面。`trellis-route` 只决定执行位置，Check-All 在读取真实任务、diff 和运行上下文后决定检查深度。确定性 auto-loop 状态由 `auto_loop.py` 保存；风险归类和 light/full 语义判断仍由 Check-All skill 完成。

核心拆分为四层：

1. **Route layer**：`inline/subagent`，不再直达轻量 `trellis-check`。
2. **Check-All policy layer**：解析 requested depth、hard-full 安全底线、自动判定和报告契约。
3. **Validation layer**：light 复用受影响规划条目与 `trellis-check` 检查清单；full 执行三个维度。
4. **Disposition layer**：interactive 报告后停止；validated auto-loop 自动 `record + next`。

## Source Of Truth And Distribution

真实源位于 `vendor/skill-garden/.trellis/0.6/`：

- `.agents/skills/trellis-check-all/SKILL.md`
- `.claude/skills/trellis-check-all/SKILL.md`
- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`
- `.agents/skills/trellis-auto-loop/SKILL.md`
- `.claude/skills/trellis-auto-loop/SKILL.md`
- `overrides/workflow.md`
- `overrides/workflow-states/in_progress.md`
- `overrides/workflow-states/in_progress-inline.md`
- `scripts/auto_loop.py`

`npm run sync` 生成 `enhancements/0.6`。当前 dogfood `.agents` / `.claude` / `.trellis/workflow.md` 在实现后同步验证。0.5 和 old 不修改。

## Check Depth Contract

### Requested Depth

```text
requested_depth = full | light | auto
```

优先级：

1. 当前检查请求里最新的显式 `full/light`。
2. validated auto-loop state 的 `check_depth`。
3. 默认 `auto`。

历史 auto-loop state 缺少 `check_depth` 时返回 `full`，保持升级前行为。

### Effective Depth

```text
effective_depth = full | light
```

决策顺序：

1. `requested=full` -> full。
2. 命中 hard-full -> full；若 requested=light，记录 escalation。
3. `requested=light` 且无 hard-full -> light。
4. `requested=auto` 且高置信满足 light eligibility -> light。
5. 其它情况 -> full，不询问。

### Hard-Full Signals

- 复杂任务存在 design/implement，且改动需要完整验收映射。
- 跨层、跨包、跨仓或 submodule。
- 公共 API / CLI / schema / 持久化状态 / 缓存契约。
- migration、历史数据、权限、鉴权、安全、资金。
- 并发、时序、状态机、回滚、生产发布、破坏性操作。
- workflow、skill、command、hook 注入或生成快照。
- 安装、升级、发布、push/commit workflow 控制面。
- 已有 full `CHK-*` 的修复后重检。
- light 执行中发现真实影响面扩大、未知 dirty path 或关键验证缺口。

### Light Eligibility

只有同时满足以下条件才高置信选择 light：

- 变更范围可完整归属，且集中在单一局部行为。
- 无 hard-full 信号。
- 受影响规划条目、直接引用点和回归路径可穷举。
- 存在可运行的定向验证，或变更仅为文案/注释/局部样式等无行为风险内容。
- 没有正在延续的 full 修复/重检链。

文件数和 diff 行数只提供证据，不作为单独阈值。

### Result Profile

Interactive 报告和 auto-loop record 都保留：

```yaml
check_profile:
  context: interactive | auto-loop
  requested_depth: auto | light | full
  effective_depth: light | full
  confidence: high | fallback-full | escalated
  reasons: [string]
```

light 通过正式满足检查门禁；未执行维度标记 `N/A`，不能伪装成已执行。

## Check-All Flow

### Step 0A: Validate Context

- 默认 interactive。
- 当前调用声称来自 auto-loop 时，通过 runner `status/next` 验证：run 为 running、当前 task 匹配、outstanding action 为 `run_check_all` 或 `run_recheck`。
- 不能用 compact summary、自然语言或直接读取 raw runtime 代替 runner 验证。

### Step 0B: Select Depth

- 收集当前任务 artifacts、Git 变更范围、用户覆盖和 auto-loop requested depth。
- 按 Check Depth Contract 得到 profile。
- light 执行过程中可以升级 full；升级后重新补齐所有适用 full 维度。

### Light Path

- Step 1 只追踪受影响的 PRD/design/implement 条目；无活动任务时为 N/A。
- Step 2 只运行已命中 Trigger 的关键假设维度。
- Step 3 复用 `trellis-check` 的 spec、diff、lint/typecheck/test、复用和一致性清单。
- Check-All 的 audit-only 规则覆盖 `trellis-check` 的直接修复和独立停止语义。

### Full Path

维持现有三维度 collect-all：规划实现、关键假设、完整性与规范。

## Auto-Loop State Contract

### Run State

新 run：

```json
{
  "check_depth": "auto"
}
```

- `start --check-depth auto|light|full` 写入该字段，默认 auto。
- `retry-blocked --check-depth ...` 可更新同一 run，并追加 decision 记录。
- 旧 state 缺字段时读取为 full；不要求 schema migration 或重写旧文件。

### Action Output

`run_check_all` / `run_recheck` action 增加：

```json
{
  "requested_check_depth": "auto|light|full",
  "minimum_check_depth": "light|full|null"
}
```

- 初次检查 minimum 为 null。
- recheck 使用上次 effective depth 作为 minimum，full 不得降级。

### Record Input

`record` 为检查 action 增加可选参数：

```text
--effective-check-depth light|full
--check-depth-reason <summary>
```

更新后的 skill 必须传入。为兼容旧调用，缺失 effective depth 时记录 `full` 与 `legacy-default-full`，不得按 light 推进。

runner 在 item 中保存 `last_check`，至少包含 action、requested/effective depth、reason、result 和时间。失败摘要继续使用现有 `last_failure`；不改变 fix/recheck 预算。

## Post-Check Disposition

### Interactive

- 输出统一报告。
- 有问题时提供一次修复范围选择；无问题时只指向 Phase 3.3 / 3.4。
- 停止等待用户，不生成 commit 计划，不 finish-work。

### Auto-Loop Inline

- Check-All 完成后立即执行匹配 outstanding action 的 `record`。
- 随后立即调用 `next`；根据返回值进入 run_fix、run_spec_update、commit_only 或下一任务。
- 不展示普通修复选择，不等待用户确认子任务推进。

### Auto-Loop Subagent

- subagent 返回 audit-only 结构化结果和 check profile，不操作 commit。
- 主会话收到结果后立即执行 runner `record + next`；不得先套用 interactive stop gate。

只有产品决策、越权、生产副作用或破坏性安全边界使用 `blocked`。

## Prompt Precedence And Context Budget

- Check-All skill 保存完整深度与 disposition 语义。
- workflow hub 只保留两条高优先级边界：validated auto-loop 先 `record+next`；否则 interactive stop。
- 两个 in-progress state 各保留一句同义短门禁，不复制 runner 命令或完整矩阵。
- 用替换/收缩现有 Post-Check 文案控制增量，运行默认与 strict context budget。

## Route Compatibility

- 删除 `trellis-route` 中“轻量 check 隐藏逃生口 -> 顶层 trellis-check”的映射和选项。
- 用户明确 light 时，route 仍解析 `check-all-inline/subagent`；Check-All 从当前请求读取 requested depth。
- route_state.py 的合法 check mode 保持不变，无需迁移个人 prefs/runtime。

## Failure And Rollback

- depth 判断无法收敛：fallback full，不阻塞。
- auto-loop 验证失败：按 interactive 处理前必须报告未验证原因；不得假装拥有 auto-loop 授权。
- runner record action mismatch：停止续跑并报告 runner 错误，不手改 runtime。
- prompt/runner 变更可通过回退 skill-garden commit、重新 sync 和 dogfood update 恢复。
- 不修改 commit-only、安全归属、push、finish-work 和归档逻辑。

## Testing Strategy

- Python runner tests：start/retry 的 check_depth、旧 state full fallback、action payload、record last_check、失败到 run_fix、recheck minimum、通过到 spec_update、多任务继续。
- Static skill contract tests：统一入口、无 direct trellis-check escape、Auto-Loop Return Gate 位于 interactive stop 之前、state guard 包含短例外、agents/claude parity。
- Snapshot/dogfood：vendor -> enhancements parity、当前 `.agents/.claude/.trellis/workflow.md`、重复叠加幂等。
- Context budget：默认与 strict。
