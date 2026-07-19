# 处理 Skill-Garden 注入与上游 Trellis 冲突

## Goal

系统识别并消除 Skill-Garden Patch 与上游 Trellis 工作流、技能、命令、Hook 之间的语义冲突、重复规则和所有权歧义，同时建立 Trellis 升级后的可重复漂移检查，避免继续依赖“高优先级覆盖下方旧规则”。

## Background

- 上一任务已经把 0.6 文件修改统一到 Patch Engine，并通过结构化 `replace/remove` 解决了 workflow-state 双正文、Update-Spec `Interactive Mode` 和 Finish-Work 双流程。
- 当前 Patch catalog、发布快照和 dogfood 已一致，现有 31 个适用操作全部成功；本任务不再改造 Patch Engine 基础协议。
- 最终 `.trellis/workflow.md:247` 仍明确声明 Hub 覆盖下层 `Active Task Routing`，实际被覆盖的是 `.trellis/workflow.md:464` 的直接 dispatch 规则；inline 表中的 `.trellis/workflow.md:472` 也绕过统一 route 决策直接进入 before-dev/check。`.trellis/workflow.md:402` 与 `:421` 属于两个运行态的一跳 route 门禁，应按高频职责判断是否保留，而不能误归类为下层 routing 表。这说明机械注入已统一，但内容所有权尚未完全收敛。
- Skill、Command 和 Hook 也需要按“上游原文 → Patch 声明 → 最终产物”三方反向核对，不能只搜索 marker 或依赖当前 Check-All 通过结论。
- `src/lib/variant.js` 当前把 `minor >= 6` 或 `major >= 1` 的 Trellis 都映射到 `0.6` catalog，但 `package.json` 和现有集成 fixture 只锁定 `@mindfoldhq/trellis@0.6.5`。长期门禁必须显式处理“版本被映射但未经过 baseline 审核”的情况。

## Requirements

### R1. 完整冲突盘点

- 对全部 Skill-Garden 与 Flower Patch 目标建立三方对照：当前支持的上游 Trellis baseline、Patch operation/selector/content、应用后的最终文件。
- 每项必须分类为：真实矛盾、同义重复、所有权歧义、上游漂移、平台差异或可接受分层。
- 盘点必须覆盖 Workflow Hub/State、Start、Brainstorm、Update-Spec、Finish-Work、SessionStart/shared Hook 和结构化平台配置。

### R2. 内容所有权归一

- 采用“上游优先、Patch 只保存必要差异”：当上游行为已经满足产品目标时，删除或缩短本地 Patch；只有上游与明确的 Flower/Skill-Garden 产品决策冲突时才由 Patch 接管。
- 同一完整规则只能由一个权威层持有；Hub/State 只保留必须高频出现的短门禁和指向。
- 能通过 Patch `replace/remove` 删除的上游冲突正文，不得继续使用“高优先级覆盖”“忽略下方规则”等文字压制。
- 保留上游仍有效的行为、模板、异常边界和平台差异；不得为了减少文本直接整文件接管所有目标。
- 最终测试验证产品行为和职责唯一性，不要求某段规则必须继续由 Patch 提供。

### R3. 冲突处理策略

- 结构可唯一定位时使用现有 Markdown/结构化 Adapter 精确 `replace/remove`。
- 语义冲突但无法由仓库证据唯一裁决时，形成明确的 review 项，不静默选择 Skill-Garden 或上游版本。
- selector/baseline 必须来自可追溯的上游版本；不得使用宽泛字面量或 fallback 顶部追加掩盖漂移。

### R4. 升级防回归

- 本任务必须同时交付当前 Trellis 0.6.5 冲突清理和未来 Trellis 升级的可重复回归门禁，不接受只修当前文本的一次性方案。
- 版本兼容采用三级策略：已登记 baseline 的版本正常应用；同一 `0.6.x` 未审核 patch 版本仅在完整预检和冲突断言通过后带 `untested-upstream` 警告继续；`0.7+` / `1.x` 不得自动复用 `0.6` Patch。
- 未支持的新 minor/major 必须给出可执行提示，允许用户通过 `--no-enhance` 使用纯上游 Trellis；不得提供静默强制应用。
- Trellis 上游升级后，应能识别原文变化导致的 selector 漂移、已删除规则复现、同义规则新增和最终产物职责重复。
- 检测结果必须区分阻断性矛盾、评审型重复和正常平台缺失，不能把 `missing-target` 展示成内容冲突。
- 冲突结果固定分为：`error`（互斥协议、selector/baseline 漂移、旧冲突规则复现、未支持新 minor/major）、`warning`（同义重复、职责可能过量、同一 0.6.x 未审核版本）、`info`（正常 missing-target、已是最终态、上游已覆盖的收敛建议）。
- `error` 阻止 Patch 应用或 CI；`warning` 允许继续但必须展示目标、规则和证据；`info` 不计入失败或冲突数量。
- 冲突检查由一个共享确定性模块提供，运行时 `applyEnhancements()`、`npm test`、`check-snapshot` 和维护者脚本必须复用同一结果模型，禁止各自维护规则副本。
- 提供 `node scripts/check-patch-conflicts.mjs` 作为维护者完整报告入口；本任务不新增公开 `flower-trellis doctor` 命令。
- 检查应基于最终产物与受支持上游 fixture，不引入依赖模型判断的非确定性语义门禁。

### R5. 验证与上下文预算

- 为每个已处理冲突增加正向最终行为断言和反向旧规则不存在断言。
- JS/Python consumer 对共享 Skill-Garden Patch 继续保持等价；Flower 平台配置由 JS 集成测试覆盖。
- 重新测量最终 Workflow、State、Phase Summary、SessionStart 和被修改 Skill；保持 warning-first，不通过提高 ceiling 掩盖重复。

## Out of Scope

- 不修改 Trellis 上游仓库或要求上游适配 Skill-Garden。
- 不迁移 0.5/old legacy 注入内容，除非盘点发现会破坏 0.6 升级路径。
- 不实现依赖 LLM 的通用自然语言冲突检测器。
- 不重新设计已经稳定的 Patch schema、备份或事务边界。

## Acceptance Criteria

- [x] AC1：所有当前 0.6 Patch 目标均进入三方冲突矩阵，没有只检查 Workflow 而遗漏 Skill/Hook/配置的目标。
- [x] AC2：已确认的真实矛盾和同义重复通过精确 `replace/remove` 或职责下沉消除，最终产物不再依赖可删除的覆盖式声明。
- [x] AC3：每个移除项都有对应的上游 baseline、保留行为说明、正向断言和旧规则不存在断言。
- [x] AC4：无法唯一裁决的内容以结构化 review 结果保留，不被 required Patch 静默覆盖。
- [x] AC5：支持的 Trellis fixture 出现 selector 漂移、旧规则复现或新增职责重复时，测试能够确定性失败并给出目标/Patch/原因。
- [x] AC6：缺失平台入口继续作为正常 `missing-target`，不计入内容冲突或失败数量。
- [x] AC7：完整测试、双消费者 parity、dogfood 幂等、源/快照一致性及默认/strict 上下文预算通过。
