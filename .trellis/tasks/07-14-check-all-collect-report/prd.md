# 优化 Check-All 检查与修复体验

## Goal

将 `trellis-check-all` 从“发现一个问题就暂停一次”的碎片化交互，调整为一次完成可继续的只读检查、统一输出问题清单，并在进入代码修改前仅确认一次修复范围。小型低风险改动应快速跳过不适用维度，大型或高风险改动仍保持完整审查强度。

## Background

- 当前 Step 1 和 Step 2 在发现实现偏差、未实现或假设错误时要求立即暂停，容易形成“发现一个、询问一次、修改一次”的重复交互：`vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/SKILL.md:141`、`:255`。
- 当前 Step 3 委托 `trellis-check`，而已安装副本中的 `trellis-check` 包含“直接修复”指令，与 `check-all` 的“用户确认后再修复”边界不一致：`.agents/skills/trellis-check/SKILL.md:41`、`:96`。
- 0.6 的 `check-all subagent` 在没有专用 `trellis-check-all` agent 时会回退到 `trellis-check` agent；当前 Codex 和 Claude agent 的高优先级角色指令都强制“发现后直接修复”，无法仅靠普通 dispatch prompt 可靠切换为 audit-only：`.codex/agents/trellis-check.toml`、`.claude/agents/trellis-check.md`。
- 当前 0.6 强化包复制链路只分发 `.agents/skills` 与 `.claude/skills`，不会安装 `.codex/agents` 或 `.claude/agents` 下的专用 check-all agent：`src/lib/copy-skills.js`。
- 现有汇总报告只有维度结果和宽泛的 P0/P1 分类，缺少稳定问题 ID、统一证据字段、无法验证状态、修复批次和对称的修复结果。
- 用户已确认采用 collect-all 模式，并希望输出风格参考 `trellis-push`：固定顺序、精确清单、风险分离、单次确认、执行前后结构对称。
- 本任务只覆盖 0.6 变体。0.6 强化包的源文件位于 `vendor/skill-garden/.trellis/0.6/`；`npm run sync` 生成 `enhancements/0.6/` 发布快照，当前 dogfood 的 `.agents/` 与 `.claude/` 副本也需要保持一致。
- 现有 Post-check Stop Gate、`trellis-route` 路由决定和 auto-loop runner 边界必须保留，不得把检查报告扩展为提交计划。

## Requirements

### R1. Collect-All 只读检查

- 默认完成所有仍可继续的只读检查，发现问题时记录并继续，不逐项询问用户。
- 只有以下情况允许立即暂停：
  - 规划或业务行为存在冲突，无法判断正确实现；
  - 问题会使后续检查结论失真或失去有效前提；
  - 继续执行验证可能产生破坏性副作用、数据风险或外部系统写入。
- 普通 lint、typecheck、测试失败以及实现偏差不得自动触发逐项修复询问。

### R2. 适用维度与快速路径

- 先根据实际变更判断 Step 1、Step 2 各维度是否适用；不适用项标记为 `N/A` 并跳过。
- 局部低风险变更只追踪受影响的规划条目、直接引用点和必要回归路径。
- API 契约、数据模型、权限、跨层数据流、历史数据兼容或最终发布检查应执行完整适用范围审查。
- 无法完成的环境验证必须标记为“阻塞”或“部分验证”，不得用通过代替未知。

### R3. 统一问题模型

- 每个独立根因分配稳定 ID：`CHK-001`、`CHK-002`，同一根因的多个位置合并为一个问题并列出全部受影响点。
- 严重级别按实际影响划分，而不是按检查步骤划分：
  - `P0`：数据破坏、安全事故或无法安全继续；
  - `P1`：功能错误、需求违背或发布阻塞；
  - `P2`：测试保护、规范、可维护性或非阻塞风险。
- 每个问题统一包含：标题、来源、证据、影响、建议、受影响位置和验证方式。
- 维度状态统一支持：通过、未通过、部分验证、阻塞、`N/A`。

### R4. 统一检查报告

- 报告固定按以下顺序输出：
  1. 标题与总览行；
  2. 任务、检查范围和总体结论；
  3. 维度结果表；
  4. 按严重级别排序的问题清单；
  5. 未覆盖验证与剩余风险；
  6. 建议修复批次；
  7. 单次修复范围选择。
- 总览行至少包含：总体状态、维度数、问题数、各严重级别数量和验证通过数。
- 问题较多时按根因合并，不得静默省略独立问题。
- 无问题时省略问题清单和修复批次，直接给出通过结论及未覆盖风险。
- 报告不得包含 commit message、拟提交文件、暂存计划或提交确认。

### R5. 单次修复确认

- 全部可继续检查完成后，仅询问一次修复范围。
- 标准选择为：`修复全部`、`修复 CHK-001,CHK-003`、`仅保留报告`。
- 用户选择修复范围后，批量完成无歧义修改和对应验证，不再对每个问题重复询问。
- 修复中出现新的业务歧义、破坏性风险或范围扩张时才重新暂停确认。
- `check-all` 调用 `trellis-check` 时必须明确使用只读审查语义，覆盖其中“直接修复”或“失败后立即修复”的指令；新增测试或代码修改也必须等待修复范围确认。

### R6. 统一修复结果

- 修复完成后输出与检查报告对称的“Check-All 修复结果”。
- 结果至少包含：总览、每个 `CHK-*` 的修复状态与验证状态、未修复项、剩余风险和重检结论。
- 修复后执行相关定向验证，并重新运行适用的 Check-All 范围。
- 若仍有问题，继续沿用原问题 ID；新发现的独立根因使用后续 ID。

### R7. 工作流兼容

- 保留 Phase 2.2 的 `trellis-route` 入口和当前任务内修复/重检复用既有 check route 的行为。
- 普通流程检查报告输出后停止；有问题时等待修复范围选择，通过时指向 Phase 3.3，再到 Phase 3.4 `trellis-push`。
- auto-loop 继续使用 runner 的 `record` + `next` 规则，不引入普通模式的额外交互确认。
- inline 与 subagent 两种 check-all 路由必须遵循相同的问题模型和报告结构；subagent 遇到真正阻塞条件时返回主会话处理，不自行模拟用户决定。
- subagent 审查阶段不得继承或回退到“发现问题后直接修复”的 agent 行为；必须使用能够遵守 audit-only 契约的专用或通用 subagent。

### R8. 源文件与同步

- 只修改 skill-garden 0.6 变体中的 `.agents` / `.claude` 源副本，并保持两种平台语义一致。
- 运行 `npm run sync` 生成发布快照，不直接把 `enhancements/` 当作源修改。
- 同步当前项目 `.agents/skills/` 与 `.claude/skills/` 下的 `trellis-check-all`、`trellis-route` dogfood 副本。
- 不修改 npm 全局安装目录或 `node_modules`。

## Acceptance Criteria

- [ ] AC1：普通实现偏差、测试失败或假设错误只进入问题清单，不会在检查过程中逐项询问。
- [ ] AC2：只有业务歧义、结论前提失效或破坏性风险会立即暂停，并明确暂停原因。
- [ ] AC3：低风险文案或普通配置改动可将不适用维度标记为 `N/A`，不会展开无关的 API、数据历史或跨层检查。
- [ ] AC4：检查报告始终使用固定顺序，并为每个独立根因生成稳定 `CHK-*` ID、影响级严重度和完整证据字段。
- [ ] AC5：报告能够表达通过、未通过、部分验证、阻塞和 `N/A`，未执行的环境验证不会被报告为通过。
- [ ] AC6：问题报告末尾只出现一次修复范围选择，支持全部修复、按 ID 选择和仅保留报告。
- [ ] AC7：用户确认修复范围后批量修改并统一验证，不逐项重复确认；新业务歧义或破坏性风险除外。
- [ ] AC8：修复结果与检查报告结构对称，能够逐项展示原问题 ID 的修复和验证状态。
- [ ] AC9：`check-all` 委托 `trellis-check` 时不会在用户确认前修改代码或新增测试。
- [ ] AC10：Post-check Stop Gate、Phase 3.3/3.4 边界、route 复用和 auto-loop 行为保持兼容。
- [ ] AC11：目标变体的 `.agents` / `.claude` 源副本、`enhancements/` 快照和当前 dogfood 副本内容一致。
- [ ] AC12：Phase 2.2 提交前完成 0.6 源、发布快照和 dogfood 副本的逐文件一致性检查，`git diff --check` 通过且无计划外文件。双仓提交后的 `check-snapshot` 属于 Phase 3.4 交付验证，不作为提交前 Check-All 的通过条件。

## Out of Scope

- 重设计 `trellis-route` 的模式选择或个人偏好机制。
- 修改 Trellis npm 包内置的基础 `trellis-check` skill；本任务在 `check-all` 内明确覆盖其修改指令。
- 为 flower-trellis 引入新的自动化测试框架。
- 新增或分发平台专用 `trellis-check-all` agent 文件；0.6 路由使用现有专用 agent（若平台已有）或通用 audit-only subagent。
- 修改 Phase 3.4 的提交、推送或任务进度同步行为。
- 改变 `trellis-check-all` 的三维核心模型：规划实现、假设验证、完整性与规范。
- 修改 0.5 或 old 变体的 `trellis-check-all` 行为。
