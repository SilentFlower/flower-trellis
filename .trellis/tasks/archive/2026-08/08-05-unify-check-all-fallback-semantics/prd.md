# 统一 Check-All 兜底分类语义

## Goal

将 Check-All 现有的 `CHK-*` 必修问题与 `OPT-*` 可选改进模型收敛为按问题性质分类的 `CHK-*`、`FBK-*`、`DOC-*` 三通道模型。逻辑错误、契约违背和验证失败继续进入 `CHK-*`；额外 fail-closed、防御性保护、异常输入与故障降级缺口统一进入 `FBK-*`；低风险任务文档漂移继续进入 `DOC-*`。

`FBK-*` 不是可选级别。它与 `CHK-*` 一样进入修复循环、被 `修复全部` 覆盖并阻断 strict pass，避免同一类兜底问题再被拆成“可选兜底”和“不可选兜底”两套处置语义。

## Background

- 上一任务新增了独立 `OPT-*` 通道，用于把当前行为正确时的防御性增强标为可选修复：`.trellis/tasks/archive/2026-08/08-05-check-all-optional-findings/prd.md`。
- 真实使用中，阿里云 Skill 的无效迁移声明 fail-closed 缺口被记录为 `CHK-*`，用户指出它本质仍是兜底问题。现有模型必须先判断“可选或必修”，才能决定 `CHK-*` / `OPT-*`，导致问题性质与处置状态混在一起。
- 当前真实源在 `vendor/skill-garden/.trellis/0.6`，Flower 的 `enhancements/0.6` 和项目 dogfood 副本均由同步链生成或投影；0.5 与 old 版本不属于本次范围。
- 当前 `trellis-check-all`、`trellis-route`、专用 check-all agent、workflow Phase 2.2、auto-loop、untracked、`trellis-push` 和项目规范都显式依赖 `OPT-*` 的非阻断语义。

## Requirements

### R1. 建立正式兜底通道

- 使用稳定编号 `FBK-001`、`FBK-002` 表示兜底问题，与 `CHK-*`、`DOC-*` 分开编号。
- 以下根因优先进入 `FBK-*`：缺少或错误的 fail-closed 保护、异常输入保护、失败路径降级、额外容错、防御性权限或数据保护、故障可观测性兜底。
- 即使兜底行为已写入 PRD、design、implement、spec 或公开契约，只要根因性质是兜底缺口，仍进入 `FBK-*`；契约证据用于确定影响和严重度，不把它改列为 `CHK-*`。
- `CHK-*` 保留给主路径逻辑错误、需求或契约的非兜底违背、失败验证、真实数据流断点、兼容性错误和发布阻塞。
- `DOC-*` 自动修复白名单、黑名单和写入时机保持不变。

### R2. 取消可选问题语义

- 从 0.6 Check-All 模型中移除 `OPT-*`、`可选改进`、`为什么可选`、`修复全部可选项` 和“optional-only 通过”语义。
- 不再要求用户为兜底问题单独授权，也不再展示“可选修复/不可选修复”。
- `修复全部` 同时覆盖全部 `CHK-*` 与 `FBK-*`；精确修复允许混合 ID，例如 `修复 CHK-001,FBK-002`。
- `仅保留报告` 仍可作为显式停止选择，但未解决的 `CHK-*` 或 `FBK-*` 必须继续显示为未通过或剩余风险，不能伪装 strict pass。

### R3. 严格控制兜底准入

- `FBK-*` 必须有具体位置、可验证的失败或异常场景、明确保护收益和修复验证方式。
- 纯代码风格偏好、没有可达场景的泛化“更健壮”、主观重构建议和无法验证的假设不进入报告。
- 分类不确定时根据根因证据选择 `CHK-*`、`FBK-*`、部分验证或阻塞；不得用旧 `OPT-*` 语义逃避修复。
- `CHK-*` 与 `FBK-*` 均在分类后根据当前实际影响分配 P0/P1/P2；严重度不改变通道归属，也不改变两者都需处理的处置规则。

### R4. 统一报告与修复循环

- 总体摘要、维度表、问题清单、修复批次和修复结果分别统计 `CHK-*` 与 `FBK-*`，不再统计 `OPT-*`。
- 报告中 `FBK-*` 展示来源、证据、兜底场景、保护收益、建议、位置和验证。
- 存在任一 `CHK-*` 或 `FBK-*` 时，interactive 报告只在末尾提供一次修复范围选择。
- 修复后保留原 ID；新根因使用对应通道的下一个编号。重检深度、route 复用和 `DOC-*` 处理保持现有契约。

### R5. 统一完成链处置

- strict pass 要求剩余 `CHK-*` 和 `FBK-*` 均为 0，并且无阻塞、无部分验证、无待用户接受的实质剩余风险。
- untracked 流程存在 `CHK-*`、`FBK-*`、阻塞、部分验证或新编辑时回到 `implement`。
- validated auto-loop 存在任一 `CHK-*` 或 `FBK-*` 时记录 `failed` 并进入 fix/recheck；只有两者均为 0 时才记录 `ok`。
- direct Git、Update-Spec 和 Push 只有在剩余 `CHK-*`、`FBK-*` 均为 0 时走严格通过路径。
- `trellis-push` 不再把任何兜底发现标为“通过但可选”；未解决 `FBK-*` 与未解决 `CHK-*` 一样属于阻断 findings。

### R6. 多平台与发布一致性

- 修改 skill-garden 0.6 的 `.agents` / `.claude` Check-All、route、push 和专用 agent 源，保持双平台副本一致。
- workflow Phase 2.2 Patch、当前项目 workflow、`.trellis/agents`、Claude/Codex agent 投影与 Flower `enhancements/0.6` 快照使用相同 `CHK-*` / `FBK-*` / `DOC-*` 契约。
- 将 `references/optional-findings.md` 重命名为 `references/fallback-findings.md`，所有引用和测试同步更新，不保留两个并行分类文件。
- 更新当前 `enhancements-model.md` 的 Check-All、auto-loop、untracked 和 push 场景；归档任务材料保持历史原文，不回写旧记录。
- 不修改 skill-garden 0.5、old 或无关平台行为。

### R7. 回归测试

- 将现有 optional findings 回归改为 fallback findings 回归，覆盖源、快照和 dogfood 一致性。
- 测试 `CHK-*` / `FBK-*` 分类优先级、兜底准入、主观建议不报告、两类问题都分配严重度。
- 测试 `修复全部` 同时覆盖两类问题，精确混合 ID 可修复，且不再出现 `修复全部可选项`。
- 测试存在 `FBK-*` 时 interactive、untracked、auto-loop、direct Git 和 Push 均不视为 strict pass。
- 运行完整 Node/Python 测试、Patch 冲突、compiled targets、上下文预算、快照一致性、语法和 diff 检查。

## Acceptance Criteria

- [ ] AC1：0.6 Check-All 只使用 `CHK-*`、`FBK-*`、`DOC-*` 三通道，不再出现 `OPT-*` 或可选修复授权语义。
- [ ] AC2：fail-closed、异常输入、失败路径降级和防御性保护缺口统一记录为 `FBK-*`，即使它同时违反已声明兜底契约。
- [ ] AC3：`CHK-*` 与 `FBK-*` 均按实际影响分配 P0/P1/P2，`修复全部` 默认覆盖两类问题。
- [ ] AC4：纯偏好或无具体可验证收益的“更健壮”建议不进入报告；分类证据不足时不得伪装成兜底项。
- [ ] AC5：存在任一 `FBK-*` 时 Check-All 不得 strict pass，auto-loop 记录 `failed`，untracked 返回 `implement`，direct Git/Update-Spec/Push 不继续。
- [ ] AC6：统一报告和修复结果分别统计 `CHK-*`、`FBK-*`、`DOC-*`，且只出现一次修复范围选择。
- [ ] AC7：route、专用 check-all agent、workflow Patch、push、当前 dogfood 与 Flower 快照使用同一三通道模型。
- [ ] AC8：0.5/old 无漂移，完整质量门和快照一致性检查通过。

## Out Of Scope

- 修改 Check-All 的 light/full 深度选择、三维检查顺序或 audit-only 边界。
- 修改 `DOC-*` 自动修复白名单、auto-loop 预算、route inline/subagent 选择或 Git 确认门禁。
- 为 findings 新增持久化文件或跨会话稳定编号。
- 回写已归档的 optional findings 任务文档或历史会话记录。

## Notes

- 本任务是跨 Skill、workflow、agent、快照、规范和测试的复杂任务，使用 `design.md` 与 `implement.md`。
- 需求依据来自 Codex 会话 `019fd1d8-9900-7da0-8c70-f36964fc6f62` 中用户确认：“兜底的就纳入兜底别出现啥可选不可选”。
