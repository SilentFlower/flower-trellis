# Maven 验证集成所需 Owner 契约索引

本文件只提炼当前任务实施必须遵守的 owner 边界；完整权威文本仍在 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。

## Check-All

- 所有用户可见检查入口统一进入 `trellis-check-all`；route 只选择 inline/subagent，不产生 Maven 特例 route。
- Check-All 收集阶段 audit-only，只允许运行无业务写入副作用的验证；普通代码、配置、测试和任务语义不得直接修复。
- 专用 Check-All subagent 只能读取本地 Skill、运行无写入验证并返回 `check_profile`、`CHK-*`、`FBK-*`、`DOC-*`、blocked checks 和 residual risk。
- Codex Check-All subagent 使用 read-only sandbox；其它平台也必须保持等价只读 allowlist/frontmatter。
- 验证失败、缺失必需验证或覆盖不足进入 `CHK-*` 或“部分验证/阻塞”，不能为了 strict pass 静默省略。
- light/full 都要求项目验证覆盖实际变更范围；light 只运行定向验证，full 覆盖全部适用验证。
- 用户可见报告必须说明已执行验证、未覆盖风险和证据；Maven evidence 只能成为该证据的一部分，不能代替三件套/假设/规范审查。

对本任务的直接推论：

- `maven_verify.py check` 必须严格只读。
- audit-only Check-All subagent 不得调用 `plan run` 或直接执行 Maven goal，因为它们会写 `target/`、本地仓库或缓存。
- evidence reusable 时可以纳入项目验证；stale/partial/failed/blocked 时必须报告精确缺口。

## Implement

- implement owner 负责修改实现，并在报告前完成变更范围内的自检。
- agent 报告必须包含验证结果和剩余问题；不能只报告改动文件。
- 新 Maven Skill 是 implement 的验证子能力，不接管业务实现、任务 scope 或 Check-All 结论。

对本任务的直接推论：

- Maven 项目迭代可用 quick 计划，交付前应使用 final 计划或明确说明未执行原因。
- implement 报告 evidence 路径、coverage 和 risks，Check-All 才能做确定性复用判断。

## Skill-Garden Source 与投影

- 0.6 canonical authoring source 位于 `vendor/skill-garden/.trellis/0.6/`。
- `npm run sync` 机械生成 `enhancements/0.6/` 发布快照；dogfood 是 Plugin 部署结果，不能反向充当 authoring source。
- 平台 Skill 投影统一读取 `ENHANCEMENT_SKILL_TARGETS`；共享物理 root 不代表全部逻辑平台启用。
- partial install 必须保持能力闭包，选择 Maven Skill 或依赖其证据检查的 Check-All 时都要投影 `maven_verify.py`。
- Patch 负责修改 owner 合同；workflow Hub 只保留 owner 和顺序，不复制 Maven SOP。

## 需要回读完整规范的情况

- 修改 Check-All route mode、问题模型、报告模板、auto-loop 或风险接受语义。
- 修改 Plugin transaction、ownership、平台检测或 content projection 基础算法。
- 新增与 Maven evidence 无关的 workflow state 或 task lifecycle 状态。
