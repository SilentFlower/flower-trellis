# Design — 修正 check 后路由规则

## 背景

当前 0.6 覆盖文案要求 Phase 2.1 进入 implement route，Phase 2.2 进入 check route。这能防止首次 check 绕过 `trellis-route`，但没有清楚区分“首次进入检查阶段”和“同一轮 check 失败后的修复闭环”。结果是模型在 check 发现问题或用户指出问题后，可能再次调用 `trellis-route` 询问执行模式。

另一个问题是：如果 check 没有个人默认配置，模型有时会按 inline check 继续执行。这违反 `trellis-route` 的核心规则：无有效偏好且 helper 不可用时，应展示同编号选项并等待用户选择，而不是自行选择 inline。

## 目标语义

首次进入执行阶段：

- Phase 2.1：调用 `trellis-route(implement)`，决定实现模式。
- Phase 2.2：调用 `trellis-route(check)`，决定检查模式。

同一轮修复闭环：

- check 发现问题后，进入修复与重检循环。
- 修复沿用最近一次 implement 路由决定。
- 重检沿用最近一次 check 路由决定。
- 不弹出新的 route 选择，除非用户明确要求重新选择、临时覆盖、清除默认，或已经进入新的独立检查阶段。

新的独立检查阶段：

- 例如提交前复查、check 后代码又有额外变化、风险升高、2.2 结果缺失，或用户明确要求最终复查。
- 可以重新进入 `trellis-route(check)`。

## 修改范围

- `.trellis/workflow.md`
- `.agents/skills/trellis-route/SKILL.md`
- `.claude/skills/trellis-route/SKILL.md`（如果存在）
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-route/SKILL.md`
- `enhancements/0.6/**` 对应快照
- `enhancements/MANIFEST.json`

## 文案策略

workflow hub 负责定义全局规则：

- 首次进入 Phase 2.1 / 2.2 时必须 route。
- check 失败后的同轮修复/重检复用最近路由决定，不重新询问。
- 无有效 check 路由时禁止自动 inline。

workflow-state guard 负责每轮注入短提示：

- 2.1 route implement。
- 2.2 route check。
- check 失败后的修复/重检沿用本轮 route。
- 无 route 决策时等待用户选择，不自动 inline。

`trellis-route` skill 负责执行模式选择：

- Step 0 明确 check 路由的准入场景。
- Step 1/2 明确无偏好时必须询问。
- Step 3 输出后的执行说明包含“本轮失败修复沿用该路由”的约束。

## 兼容性

`.trellis/.route-prefs.tmp` 格式不变。已有 `check=check-all-inline` / `check=check-all-subagent` 继续有效。

0.5 / old legacy 路径不纳入本任务，除非验证发现它们污染 0.6 主路径。

## 风险

- 只改 workflow 不改 skill，会导致执行指令仍缺少闭环复用规则。
- 只改 `.agents` 不改 `enhancements/0.6`，后续 `flower-trellis update` 会覆盖回旧语义。
- 若把“沿用最近路由”写得过宽，可能误伤提交前独立复查；因此必须把“同一轮失败修复闭环”和“新的独立检查阶段”分开。
