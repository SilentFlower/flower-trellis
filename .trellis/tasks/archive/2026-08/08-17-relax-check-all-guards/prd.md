# 放宽 Check-All 机械门禁

## Goal

减少 Check-All 中没有新增信息的固定口令、重复全量检查和自动化测试硬门槛，同时保留真实未验证风险、生产副作用授权和提交前最终审计边界。

## Background

- 当前 P0 风险接受必须逐项写出精确 ID，即使用户已经明确接受当前报告的全部风险，仍会触发再次确认。
- 当前所有环境不足都被统一标记为 `部分验证` 并阻断完成链，没有区分提交前应完成的验证与只能上线后执行的生产验收。
- 当前任一 full 修复/重检链都不得降级，局部修复也会重复执行完整 Full Check-All。
- Light profile 将“缺少自动化测试”直接记录为 `CHK-*`，而 Full profile 接受明确手动验证，两套规则不一致。
- Skill-Garden 0.6 的 canonical authoring source 位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/`、compiled targets 和当前项目 dogfood 文件均为派生产物。

## Requirements

### R1. 风险接受按当前报告语义识别

- 用户明确表示接受当前报告的全部风险时，对当前报告中的全部 `CHK-*` / `FBK-*` 生效，包括 P0；不得要求再次逐项输入 ID 或使用固定句式。
- 用户只接受部分问题时，仍需使用问题 ID 或其它能唯一对应当前报告子集的明确指代。
- 风险接受继续绑定当前问题证据与实际 diff；受影响代码、契约、验证结果、问题内容或严重度变化后自动失效。
- 无法判断用户指向哪一版报告或哪组问题时才允许追问，不得把语义明确的回复判为无效。

### R2. 区分阻断型部分验证与上线后验证

- `部分验证` 只用于当前 Check-All 结论所必需、原则上应在提交前完成但证据尚不完整的验证；它继续阻断 strict pass 和完成链。
- 只有部署后、生产环境或外部系统中才能安全执行的验收，标记为 `上线后验证`，在“未覆盖与风险”中完整展示动作、责任边界和预期结果。
- `上线后验证` 不得伪报已执行或已通过，也不得自动执行生产或外部副作用；它不属于当前代码检查的 `部分验证`，不阻断 Update-Spec、commit 或 push。
- 本可通过本地 fixture、测试环境、静态契约或无副作用命令完成，却只是尚未执行的验证，不得借“上线后验证”逃避检查。
- Check-All 和 Push 必须保留上线后验证提示；任务结束时由既有 `trellis-release` / `release.md` 流程承接，不新增平行持久化模型。

### R3. Full 修复允许定向重检

- 同一次 Check-All 执行中从 light 升级到 full 后仍不得降级，保留单次执行的一致性。
- 完成 full finding 的局部修复后，若实际修复范围、原 finding、直接引用点和回归路径可完整穷举，且存在充分定向验证，下一次重检允许选择 light。
- 结束 Phase 2.2 或进入提交链本身不再触发无条件 Full；此前 Full 证据仍适用于当前 diff，且后续修改已被定向重检完整覆盖时，可以直接复用这些证据完成检查。
- 用户显式要求 Full、修复触发真实 hard-full、影响面无法闭合、基线或相关契约变化、出现未知 dirty path，或原验证证据已失效时，才重新执行 Full Check-All。

### R4. 验证证据优先于自动化形式

- 自动化测试仍是首选验证方式，但不作为所有 Light 变更的硬性准入条件。
- 可重复、步骤明确且能覆盖关键假设的手动验证、静态验证或定向命令，可以作为有效验证证据。
- 只有缺少完成当前结论所必需的充分验证证据时才记录 `CHK-*`；不得仅因“没有自动化测试文件”生成 finding。
- Light 与 Full profile 使用一致的验证口径；高风险、易回归或项目规范明确要求自动化测试的场景仍按实际契约记录问题。

### R5. Source Of Truth 与分发一致性

- 先修改 Skill-Garden 0.6 canonical `.agents` / `.claude` 规则、必要的 route agent body 与 workflow Patch owner。
- 更新现有 Check-All、workflow、Push 和长期 spec 契约测试，使用正反断言证明放宽范围没有吞掉真实阻断。
- 运行 compiled target、Flower snapshot 和 dogfood 同步链；不得只手改 `enhancements/0.6` 或当前 `.agents` / `.claude` / `.trellis` 输出。
- 0.5 和 old 变体不在本任务范围内。

## Acceptance Criteria

- [ ] AC1：对当前报告回复“接受全部风险”“这些风险都接受”等语义明确表达时，P0 与其它 findings 一次性进入已接受状态；部分接受仍能唯一定位到目标问题。
- [ ] AC2：风险接受在相关 diff、证据或严重度变化后失效，模糊或跨报告指代仍会停止确认。
- [ ] AC3：只能部署后或生产/外部系统执行的验收被标记为 `上线后验证`，完整展示但不阻断提交链；提交前应完成却缺失的验证仍为阻断型 `部分验证`。
- [ ] AC4：Check-All 不自动执行生产或外部系统操作，Push 与后续 release 交接仍能看到上线后验证事项。
- [ ] AC5：full finding 的闭合局部修复可进行 light 定向重检；单次 light->full 不降级，完成任务或提交本身不强制再次 Full，只有范围扩大或原证据失效等明确条件才重新 Full。
- [ ] AC6：Light 与 Full 都接受充分的自动化、手动或静态验证证据；仅缺少自动化测试不再自动产生 `CHK-*`，缺少必要证据仍产生 finding。
- [ ] AC7：canonical `.agents` / `.claude`、compiled targets、`enhancements/0.6` 和当前 dogfood 投影保持一致。
- [ ] AC8：定向测试、`npm run patch:targets:check`、上下文预算、输出模板、完整 `npm test` 与双仓 `git diff --check` 通过，且不提高现有预算阈值。

## Out Of Scope

- 不改变 `CHK-*`、`FBK-*`、`DOC-*` 三类问题模型或 P0/P1/P2 严重度定义。
- 不允许 agent 代替用户接受风险。
- 不放宽破坏性操作、生产写入、外部系统操作和 Git 精确文件范围的授权门禁。
- 不让上线后验证变成“已验证”或省略发布验收记录。
- 不修改 0.5、old 变体或上游原生 `trellis-check`。
