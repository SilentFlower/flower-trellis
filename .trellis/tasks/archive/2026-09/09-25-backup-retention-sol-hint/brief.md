# Brief — 升级备份精简与 Sol 专属提示

## Goal

- 将 `flower-trellis update` 的时间戳升级备份默认保留数从 3 改为 1，并为 Codex `gpt-6-sol` 增加模型专属 SessionStart 提示。

## Scope

- 调整备份默认常量及相关测试、README 和规范；保留显式参数、dry-run、失败不清理、`.backup-flower` 排除与本轮新备份保护。
- 在 Flower SessionStart 源资产中增加 Sol 精确模型选择、独立开关和失败诊断；扩展模型、分段、来源及上下文预算验证。
- 使用隔离项目验证安装、重复更新和备份清理预览；完成定向与项目测试、语法检查和 Check-All。

## Non-Goals

- 不改变备份清理算法及显式保留数语义，不新增普通用户轮次注入或模型别名匹配。
- 不重复 Astra 的大规模行为对照实验，也不将正确注入解释为 Sol 行为改善。
- 规划阶段不执行真实项目升级、发布、提交或推送。

## Key Decisions

- Sol 首版沿用 Astra 的英文工作流正文，仅调整模型适用声明和标签；两个模型各用独立开关，默认开启，Astra 原有输出保持不变。
- 默认保留 1 份仍遵守现有安全例外：若本轮产生多份受保护备份，可临时超过 1 份，避免删除本轮恢复点。
- 每个模型只在 Codex 的 `startup`、`clear`、`compact` 的 `state` 分段精确命中时追加一块，不在普通 UserPromptSubmit 重复注入。

## Key Context

- 备份默认值由 `src/constants.js` 经 `src/lib/cli-args.js`、`src/lib/update-backups.js` 进入 `src/commands/update.js`；现有安全契约位于 `config-and-state.md` 的 `Update Backup Retention` 场景。
- 模型注入源为 `src/assets/flower_session_start.py`；现有 Astra 机制、分段与 2048 UTF-8 字节限制由 `trellis-patch-engine.md` 和 `ai-context-budget.md` 约束。
- 本任务的 PRD、设计和实施计划是实施依据；`research/context-map.md` 指向需完整补读的规范章节。

## Risks / Deferred

- 同一提示对 Sol 的行为效果尚无独立对照证据；实现验证仅能证明选择、注入和安装正确。
- 未运行与变更提交对应的 Ubuntu/Windows CI 前，不报告跨平台验收通过。

## Acceptance

- 默认更新计划保留 1 份，显式覆盖和所有既有备份安全边界通过回归；受保护备份临时超额有说明。
- Sol 的三个 SessionStart 来源各在 Codex `state` 精确注入一块，Astra 保持原提示；其他模型和 Claude 不新增模型提示。
- Sol 独立开关、非法配置、异常和超预算路径保留原生上下文并正确诊断；预算、文档和隔离安装结果一致。

## Next Step

- 实施与本地 Check-All 已完成；待用户继续后进入规范更新和提交计划。跨平台 CI 需在匹配变更提交后验证。
