# 版本需求拆分与 Wave 规划

## Goal

优化 Trellis 从“版本需求文档”拆分到“可开发 task”的规划流程：允许一个版本拆成多个 task，但每个 task 必须是内聚、完整、可开发/可验收的业务或技术闭环；wave 作为版本级分批提测 / 分批交付概念，组织这些 task 的阶段、依赖和进度。

## Background / Known Context

- 用户的最终意图是：版本可以拆成多个 task，但一个 task 不能太散；需要有 wave 概念来表达分批提测和开发阶段。
- 之前两个极端都不准确：
  - “版本规划文档拆出很多碎 task”会导致 task 过散。
  - “整个版本只能一个大 task”会导致 task 过大，不利于多人开发和局部闭环。
- 合适模型是：版本级规划先识别内聚 task，再把 task 编排到 waves。
- wave 是版本级批次，不是 `task.py` 的状态，也不要求每个 wave 必须是一个 task。
- 一个 task 可以属于一个主要 wave，也可以标记为跨 wave 前置项；必要时 task 内部也可以有轻量阶段，但不替代版本级 wave。

## Problem

版本需求拆 task 时容易出现：

- 按文档章节机械拆分，导致一个真实开发闭环被拆散。
- 按页面 / 接口单点拆分，导致一个可提测功能散落在多个 task。
- 为避免碎片化而整个版本只建一个 task，导致任务过大、多人协作和阶段检查困难。
- 散射型变更没有被归组，同一字段 / 规则 / 权限在多个入口重复改或遗漏。
- task 与 wave 的关系不清，开发者不知道当前 task 是哪个提测批次、是否能独立验收、依赖谁。

## Requirements

- 定义版本需求拆 task 的判断标准：task 应是内聚的开发单元，而不是文档章节、页面碎片或接口碎片。
- 支持一个版本生成多个 task，但每个 task 必须写清范围、非范围、来源需求、依赖、可验收结果。
- 定义 wave 为版本级可提测 / 可交付批次，用来组织 task，而不是替代 task 生命周期。
- 支持从版本需求清单生成：
  - 内聚 task 候选列表
  - task 边界说明
  - task 依赖关系
  - wave 分组
  - 每个 wave 的提测条件 / 完成条件
  - “版本需求 -> task -> wave”覆盖矩阵
- 每个 task 必须归入一个主要 wave，或明确标记为跨 wave 前置项 / 全局支撑项。
- 每个 wave 必须说明目标、包含 task、提测范围、前置条件、完成条件、是否可独立提测。
- `trellis-extract-prd` 应能基于版本规划中的 task 候选生成单 task PRD，并保留 wave 归属和版本来源。
- `trellis-verify-task` 应能校验：
  - 单 task PRD 是否偏离版本规划中的 task 边界
  - 版本需求是否都被 task 覆盖
  - task 是否都归入 wave
  - wave 是否具备可提测闭环
- 新增字段优先写入 `task.json.meta`，不改变 `task.py` 标准字段和状态机。

## Task Split Principles

- **按可验收闭环切 task**：一个 task 应尽量对应可独立实现、可自测、可说明验收结果的闭环。
- **按复用链合并**：同一规则、字段、权限、校验或导出链路在多个入口复用时，优先归到同一个 task 或同一个明确前置 task。
- **按散射变更归组**：需求文档里分散出现的同一业务概念，需要先形成散射组，再决定是一个 task、多个强依赖 task，还是同 wave 下的多个 task。
- **按提测边界排 wave**：wave 应表示“这一批完成后测试能验什么”，不是简单按人、目录、日期排序。
- **按依赖暴露半成品**：基础迁移、公共组件、接口契约等支撑 task 可以存在，但必须说明服务哪个 wave，不能伪装成可独立提测 wave。

## Decision (ADR-lite)

**Context**: 需要在“碎 task”“单大 task”和“内聚 task + version waves”之间确定模型。

**Decision**: 采用“版本级 waves + 内聚 tasks”模型。版本可以拆成多个 task，但 task 必须足够内聚；wave 是版本级批次，用来组织 task 的提测 / 交付顺序和进度。

**Consequences**:

- 避免 task 过散：每个 task 都有清晰闭环、边界和验收结果。
- 避免 task 过大：版本可拆多个 task 支持并行开发。
- wave 保留版本级视角：能看清哪些 task 组成一个提测批次。
- 不改变 `task.py` 生命周期；wave 通过版本规划文档、PRD 上下文和 `task.json.meta` 摘要表达。

## Acceptance Criteria

- [ ] `trellis-plan-version` 能输出内聚 task 候选列表和 version waves。
- [ ] 版本规划产物能展示“版本需求 -> task -> wave”的覆盖矩阵。
- [ ] task 拆分准则覆盖业务闭环、复用链、散射变更、依赖关系、提测边界。
- [ ] wave 定义、何时需要 wave、wave 与 task / parent / child / subtask 的关系清晰。
- [ ] `trellis-extract-prd` 能从版本规划 task 候选生成单 task PRD，并写入 wave 归属。
- [ ] `trellis-verify-task` 能发现 task 过散、task 边界偏离、需求未覆盖、task 未归 wave、wave 不可独立提测等问题。
- [ ] 方案兼容现有 task lifecycle，不新增 wave 状态机或命令。

## Definition of Done

- 更新 `trellis-plan-version`、`trellis-extract-prd`、`trellis-verify-task` 的 0.6 skill 文案。
- 同步 `.agents`、`.claude`、`enhancements/0.6` 和 `vendor/skill-garden/.trellis/0.6` 副本。
- 任务三件套反映“版本级 waves + 内聚 tasks”的最终模型。
- 运行文本级 / 快照级 / 任务级校验，并说明任何预期失败的原因。

## Out of Scope

- 不新增 `task.py` wave 命令。
- 不新增 wave 状态机或改变 `planning` / `in_progress` / `completed`。
- 不强制每个 wave 一个 task，也不强制整个版本只有一个 task。
- 不实现项目管理系统、甘特图或测试平台集成。

## Research References

- 暂无外部研究；本任务基于现有 Trellis task 生命周期、`task.json.meta` 扩展能力和三个 skill 的职责边界调整。
