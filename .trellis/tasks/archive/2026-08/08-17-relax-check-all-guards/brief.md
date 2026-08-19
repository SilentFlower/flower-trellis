# Brief — 放宽 Check-All 机械门禁

## Goal

- 减少固定风险口令、生产验收误阻断、跨轮重复 Full 和自动化测试硬门槛，同时保留真实未验证风险、生产副作用授权与提交前最终审计。

## Scope

- 让“接受当前报告全部风险”等语义明确表达一次性覆盖当前全部 `CHK-*` / `FBK-*`，包括 P0；部分接受仍需唯一定位目标问题。
- 将当前结论必需但未完成的 `部分验证` 与只能部署后、生产环境或外部系统执行的 `上线后验证` 分开；前者阻断，后者完整展示并交给 release 流程，但不阻断 commit/push。
- 允许 full finding 的闭合局部修复在下一轮执行 light 定向重检；同一次 light->full 仍不降级，完成任务或提交本身不再强制最终 Full，只有范围扩大或原证据失效时才重新 Full。
- 统一 Light/Full 的验证口径：自动化优先，但可重复的手动、静态或定向命令也可作为充分证据；只有缺少必要证据或项目契约明确要求自动化时才记录 finding。
- 从 Skill-Garden 0.6 canonical 更新 Check-All、route、workflow、Push 与长期 spec，再同步 compiled targets、Flower snapshot 和当前 dogfood 投影，并补齐正反契约测试。

## Non-Goals

- 不改变 `CHK-*`、`FBK-*`、`DOC-*` 或 P0/P1/P2 模型。
- 不允许 agent 代替用户接受风险，也不放宽破坏性操作、生产写入、外部系统操作或 Git 精确文件范围授权。
- 不把上线后验证伪报为已验证，不省略 release 交接。
- 不修改 0.5、old 变体或上游原生 `trellis-check`。

## Key Decisions

- 风险接受绑定当前报告语义和版本，而不是固定句式；只有跨报告或子集指向不清时才追问。
- `上线后验证` 是“未覆盖与风险”中的非阻断交接标签，不新增维度状态或 finding 通道；strict pass 表示提交前检查范围通过。
- 生产/外部验证只有在本质上依赖部署完成或真实外部状态时才可延期；本可本地无副作用完成但未执行的验证仍是阻断型部分验证。
- 跨轮修复不继承永久 full 锁定；Phase 2.2 / Git 完成链复用仍有效的既有证据，只有范围扩大、契约或基线变化、未知 dirty 或验证证据失效时才重新 Full。
- 验证质量由覆盖关键假设、可重复步骤和明确预期决定，不由是否存在自动化测试文件单独决定。

## Key Context

- canonical authoring source 位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6`、compiled targets 与当前 `.agents` / `.claude` / `.trellis` 是派生产物，不能反向手改作为真实源。
- 生产与外部系统验收已有 `trellis-release` / `release.md` owner，可承接上线后验证，不需要新建平行持久化模型。
- 相关长期规范是 `.trellis/spec/flower-trellis/cli/enhancements-model.md`、`trellis-patch-engine.md` 与 `ai-context-budget.md`。
- 实现与检查上下文已写入 `implement.jsonl` / `check.jsonl` 并通过校验。

## Risks / Deferred

- 需防止把可在提交前完成的验证误标为上线后验证；通过本质依赖部署/真实外部状态的硬条件和反向测试控制。
- 需防止 light 定向重检遗漏扩散影响；只有 finding、修复范围、直接引用点和回归路径均可穷举时允许，范围扩大或证据失效时升级 Full。
- 手动验证必须可重复且覆盖关键假设，模糊描述不构成充分证据。
- 不通过提高 AI context budget 阈值消除体量告警。

## Acceptance

- 当前报告全部风险可通过一次语义明确回复接受，包括 P0；相关 diff、证据或严重度变化后接受失效。
- 上线后验证保持可见、不可自动执行且不阻断提交；阻断型部分验证和本地可执行但缺失的验证仍阻断。
- full finding 的闭合局部修复可 light 重检，单次升级仍不降级；完成/提交不强制再次 Full，范围扩大或证据失效时仍执行 Full。
- Light/Full 接受充分的自动化、手动或静态证据，仅缺少自动化文件不再无条件产生 `CHK-*`。
- canonical、snapshot、compiled targets 与 dogfood 一致；定向测试、完整 `npm test`、上下文预算、输出模板、Patch target 和双仓 diff 门禁通过。

## Next Step

- 实现、生成同步与 Check-All 已完成；普通交互流程等待用户明确继续后进入 Update-Spec，再由 Push 生成提交计划。
