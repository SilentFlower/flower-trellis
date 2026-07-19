# Brief - 处理 Skill-Garden 注入与上游 Trellis 冲突

## Goal

- 消除 Skill-Garden Patch 与上游 Trellis Workflow/Skill/Hook 中的互斥协议、同义重复和所有权歧义，并建立未来 Trellis 升级后的确定性冲突回归门禁。

## Scope

- 对全部 0.6 Skill-Garden/Flower Patch 目标执行“上游 baseline → Patch → 最终产物”三方盘点并分类。
- 采用“上游优先、Patch 只保存必要差异”，通过结构化 section replace 清理 Active Task Routing、Phase 2.1、Phase 2.2、Phase 3.3、Phase 3.4 的冲突正文。
- 收敛 Workflow Hub 和 planning/in-progress State，只保留跨阶段短门禁与当前状态一跳动作。
- 在 Skill-Garden `overrides/` 增加共享 compatibility/conflict policy，JS/Python consumer 在写入前检查版本和最终内存产物。
- 诊断分为 `error / warning / info`；运行时、`npm test`、`check-snapshot` 和 `check-patch-conflicts.mjs` 复用同一 JS 结果模型，Python 使用相同 policy 并保持 parity。
- 拆分 Patch 汇总中的正常 `missing-target` 和真正 `optional-skip`，避免未安装平台看起来像执行失败。

## Non-Goals

- 不修改 Trellis 上游仓库，不要求上游适配 Skill-Garden。
- 不迁移 0.5/old legacy 注入内容，除非其行为会破坏 0.6 升级路径。
- 不实现依赖 LLM、正则或可执行代码的通用语义冲突检测器。
- 不重新设计 Patch 的 insert/replace/remove、备份和事务边界。
- 不新增公开 `flower-trellis doctor` 命令，也不提供未支持版本的静默 force 参数。

## Key Context

- 已确认阻断级冲突：统一 route 与上游 direct dispatch、Check-All audit-only 与上游 auto-fix、Trellis Push 默认 push 与上游 Never push。
- 当前 Hub 仍使用“overrides lower / fully supersedes”压制上游下层协议；本轮要删除冲突正文后同步删除这些覆盖式声明。
- 版本策略：`0.6.5` tested；同一 0.6.x 未审核版本完整检查后 warning 放行；0.7+/1.x error，用户可使用 `--no-enhance`。
- conflict policy 只断言 Patch plan 的 `files[].next`，不参与文本变换；首版只支持 absent-literal、required-literal、max-occurrences。
- Shared policy 源在 `vendor/skill-garden/.trellis/0.6/overrides/`，通过 `npm run sync` 进入 `enhancements/0.6`；Flower 平台配置仍由 `src/patches` 所有。
- 关键风险是 section replace 误删平台差异、精细安装误跑未选规则、JS/Python 诊断漂移和上下文去重遗漏状态一跳。

## Acceptance

- 所有当前 0.6 Patch 目标进入三方冲突矩阵，Skill/Hook/配置不遗漏。
- C-WF-001/002/003 的最终产物不再保留互斥 walkthrough 或覆盖式压制声明。
- 每个移除项有上游 baseline、保留行为、正向断言和旧规则不存在断言。
- 无法唯一裁决的内容形成 warning/review，不被 required Patch 静默覆盖。
- tested/untested-compatible/unsupported/invalid 四类版本、三类诊断和精细安装过滤均有 JS/Python parity 测试。
- 正常 missing-target 只计 info；error 保持 Patch/资产/stale/manifest 零写入。
- 完整测试、dogfood 幂等、源/快照一致性、check-snapshot 和默认/strict 上下文预算通过。

## Next Step

- 用户确认 planning artifacts 与本 Brief 后运行 `task.py start`，再进入 `trellis-route(implement)`；实现按 policy → evaluator → Workflow ownership Patch → 门禁集成 → dogfood/预算/快照顺序推进。
