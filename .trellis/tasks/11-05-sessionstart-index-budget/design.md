# SessionStart 索引发现体积修复设计

## Approach

在已有 `session-start-context-trim` Patch 中，精确替换原生 Hook 的全量规范索引输出块。保留索引收集及总数统计，把路径列表改为固定的发现提示：指南存在时提供指南路径，任务规范从当前任务的 `implement.jsonl` / `check.jsonl` 读取，再按需要使用已有 `spec_router.py` 查询。完整包目录继续由已有 `get_context.py --mode packages` 按需提供。

该修改发生在原生正文生成阶段，Flower wrapper 随后按既有规则拆分工作流、刷新当前状态并追加平台和模型提示。避免在完整 state 上按字符裁剪，也不增加新配置、自动包推断或独立缓存。

## Affected Files And Ownership

| 层 | 修改位置 | 目的 |
| --- | --- | --- |
| 作者源 | `vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/session-start/context-trim/patch.json` 及对应 `selector.*` / `content.*` | 向现有 Patch 添加精确替换；覆盖该片段的全部既有平台目标 |
| 最终产物 | `vendor/skill-garden/compiled-targets/0.6.14/`、`enhancements/0.6/` | 按生成和同步命令产生，保持与作者源一致 |
| 运行验证 | `test/python/test_flower_session_start.py`、`test/python/test_skill_garden_patches.py` | 大规模规范目录、关键内容完整性和多平台目标验证 |
| 预算验证 | `scripts/check-ai-context-budget.mjs`、`test/js/ai-context-budget.test.js` | 从最新编译目标运行 Hook，加入索引规模维度并保留现有模型矩阵 |
| 规范沉淀 | `.trellis/spec/flower-trellis/cli/ai-context-budget.md`、`trellis-patch-engine.md` | 在实施完成后记录发现清单有界和大仓库真实输出要求 |
| 本地运行副本 | 当前 Flower 项目与 `/root/project/xiaoxian-desktop` 的受管文件 | 通过 Flower 生命周期应用，经预检核对范围 |

`src/assets/flower_session_start.py` 继续拥有分段、模型提示和可见诊断逻辑；当前设计不需要修改 wrapper、额度注册或全局预算策略。

## Output Contract

1. 索引计数仍取原生收集器的真实结果，包括 Claude 既有包筛选后的可用集合。
2. 默认发现提示不随索引数量或每条路径长度线性增长；不打印目录的前 N 项，不依赖排序选出“相关”包。
3. 只有实际存在且在可用索引集合中的通用指南才生成文件入口；无指南时仍保留已有发现命令。
4. 任务规范读取顺序遵循现有 JSONL → PRD → 可选 design/implement 合同，不把任务全文或完整索引再次常驻启动正文。
5. `selector.*` 逐字保留目标输出块，`content.*` 继承目标英文和缩进。使用现有 literal selector、目标缺失策略和 Patch preflight；不新增模糊正则或独立注入器。
6. 未知模板无法唯一匹配时由既有 preflight 报错，保留完整旧文件与诊断，不猜测截断位置。

## Protected Capabilities

| 能力 | 保留方式与已有验证 |
| --- | --- |
| 三段独立与规则完整 | 保持原生正文除发现片段以外原文；沿用 `test_parallel_parts_preserve_native_content_and_fit_budget` |
| 当前任务与条件刷新 | 保留当前状态、`task-status` 和 `workflow-state`；沿用 `test_startup_clear_and_compact_refresh_full_state_and_baseline` |
| 首答、平台与模型规则 | 保留首答语言约束、平台分发、代码设计、同步交互和三类模型提示；沿用对应 Python 与十八场景 JS 断言 |
| 子进程、禁用和恢复事件 | 保留真实标准流边界及已有 `resume` / 全局禁用 / maintenance 测试 |
| 宿主显式额度 | 不修改 `additionalContextLimit`；沿用 `platform-patches` 与 `apply-enhancements` 的额度继承与幂等断言 |
| 可见失败和预算策略 | 保留超限全文与诊断、默认告警及 strict 仅阻断 high-warning 的既有语义 |

## Verification Design

- 使用隔离夹具生成 0、少量、499、1000 个索引；计数包含实际存在的 guides 索引，不能为了方便生成变成 499+1。
- 长路径用各平台可正常创建的合法目录名，验证路径清单体积不再传播到输出，不把文件系统限制当作 Hook 结果。
- 两个平台运行 `startup`、`clear`、`compact`，覆盖 `no_task` 与 `in_progress`；大规模用例包含模型提示开启，确保测量完整成本。
- 原生 SessionStart 与 workflow-state Hook 使用当前 pinned full 编译目标；wrapper 使用作者源资产；夹具自己的规范与任务目录不依赖真实活动会话。
- 对每段直接断言 `len(additionalContext) <= 8000` 和必要闭合块存在。该行为回归断言独立于全局预算 checker 的告警政策。
- 保留原有十八场景及提示差值检查；追加规模场景仍按每个平台的最大真实输出和固定 control-total 公式汇总。
- 在变体投影、隔离安装和两次更新中验证全部受影响平台；真实 Codex/Claude 三段测量与其他平台静态生成验证分别记录。

## Delivery And Recovery

先更新作者源和编译目标，再同步快照；隔离目标 preflight、首次应用和二次零变化后，按项目 SOP 重放当前 Flower 及受影响项目的受管文件。更新前检查真实目标的 ownership、已有用户修改和生成计划，记录相关 Hook 哈希；不改产品源码、任务材料或历史对话。

已截断的历史注入不会因文件更新自动补全。受影响窗口需重新读取当前任务材料，并在下一次真实 SessionStart 重建时核对宿主交付的完整正文及尾部规则。没有宿主执行证据时保留待验，不能用离线脚本输出代替。

回退使用 Flower 既有事务与备份恢复对应受管文件；若新 Patch 不能唯一匹配，停在预检失败并修正作者源，不直接覆盖目标。发版、全局升级和外部服务不在修复范围；提交推送遵循既有收尾流程的具体计划评审。

## Risks

- 现有预算夹具依赖本地少量规范和运行副本；不对齐编译目标会把旧行为误当新实现。
- 无任务工作流通常比进行中状态更长，必须纳入最大输出测量。
- 目标项目仍有其它会话工作；更新只按实际受管计划执行，历史截断的补读和新注入验收分别取证。
- 原生 Windows 与 Python 3.8/3.12 的兼容性必须由当前提交的必需 CI 结果确认。
