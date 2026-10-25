# 实施计划

## Preconditions

- [x] 用户已明确授权创建规划任务，并确定保持 Brief、问题分类和升级门禁。
- [x] PRD、设计与源码/规范证据已整理。
- [x] 完整展示 Brief，用户明确“可以 那我们开始任务吧”批准实施；`task.py start` 已将状态改为 `in_progress`。
- 进入实现与检查时分别遵守 `trellis-route`；当前规划不预先保存模式、分发 agent 或执行实现。

## Steps

1. [x] 固定作者源、生成物与默认加载集合的基线；把受保护能力映射到现有回归。
2. [x] 修正 untracked 通过后的等待条文，统一引用 Post-Check owner，并补齐通过/明确停止的反向断言。
3. [x] 收敛 route 的正常空状态至 inline；同步菜单、清除默认、只读预检与 helper，保留既有优先级和异常边界。
4. [x] 精简 Check-All 的默认读取闭包与 light 通过报告；按条件加载 DOC、findings、runner 等细则，保持分类、审计维度和深度门禁。
5. [x] 通过增量 Patch 去重 Update-Spec；按现有 references 组织 Push 的特殊分支，允许复用未变化模板。
6. [x] 同步受影响平台源及必要规范、conflict 断言和预算测试；生成 canonical compiled targets、发布快照，再通过 Plugin 生命周期更新本地结果。
7. [x] 完成定向与必要完整验证，记录修改前后实际加载集合、字节数和保留能力；进入 Check-All → Update-Spec → Push 计划。

## Validation

| 范围 | 必须证明的行为 | 现有入口 |
| --- | --- | --- |
| 流程 | task/untracked 通过自动推进，显式停止仍有效 | `untracked-flow-gate.test.js`、`workflow-gate-ownership.test.js`、`update-spec-auto-decision.test.js` |
| 路由 | 双 target 缺省 inline、偏好与覆盖、清除默认、损坏与跨任务隔离、预检零写入 | `test_route_state.py`、`route-context-budget.test.js`、`test_auto_loop.py` |
| 检查 | light 准入、full 升级、证据复用、分类、DOC 越界防护、修复不新建任务 | `check-all-smart-depth.test.js`、`check-all-fallback-findings.test.js`、`check-all-evidence-reuse.test.js`、`check-all-comment-remediation.test.js` |
| 保护能力 | Brief 与升级门禁行为不变，报告条目可读 | `brief-preauthorization.test.js`、`test_flower_update_hook.py`、`output-template-contract.test.js` |
| 分发 | 全平台 Patch 无冲突、引用完整、精细安装与生成结果一致、重复应用幂等 | `test_skill_garden_patches.py`、`platform-skill-distribution.test.js`、snapshot / compiled targets / budget / output checker |

先运行受影响专项，复用有效证据；本任务修改 Python 路由运行时并可能涉及 Patch 配置，最终按项目规范运行 `npm test`、快照检查、compiled targets 检查、strict budget 与输出模板检查。生成命令使用已验证的 `npm run patch:targets`、`npm run sync`，不手改 lock/state/hash。

推送前完成本地验证；推送后在同一提交的原生 Ubuntu/Windows CI 中核实受影响回归实际执行，Python 沿用 3.8/3.12 矩阵。CI 与 Git 动作不由本规划预先授权，正式提交仍展示精确计划并确认。

## Review And Recovery

- [x] 核对 Brief 相关源和升级相关源未被顺带修改。
- [x] 核对没有用删除根因分类、深度升级、必要验证或 Git 门禁换取文本下降。
- [x] 核对默认路径实际减少读取，特殊分支可由入口发现，整体正文未因拆分重复增加。
- 若阶段性发现影响面扩大，先更新受影响材料，只对新增未决事项取得决定；不重复已批准的全量 Brief。
- 验证失败停留在真实阶段；提交或生成部分成功时保留现场，沿现有 owner 恢复，不新增恢复状态机。

## Current Handoff

实现、验证与业务交付均完成；本地 514 项 Python（2 skip）、680 项 Node（2 skip）无失败，Windows Python 3.8 定向回归通过。两个业务仓库已提交并推送，重新 sync 后的快照洁净检查、Plugin verify 和本次提交的完整原生 CI 均通过，AC1–AC7 全部满足。完成态与 Close 通过 `task_progress.py` 原子写入，当前任务记录随独立提交同步。
