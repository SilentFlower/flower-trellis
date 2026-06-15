# 版本需求拆分与 Wave 规划设计

## Technical Design

本任务采用“版本级 waves + 内聚 tasks”的模型。版本规划先从原始需求扫描出完整需求清单，再拆成若干内聚 task，最后把这些 task 编排进 waves。wave 是版本级提测 / 交付批次，不是 `task.py` 状态。

## Core Model

### Cohesive Task

task 是可开发、可自测、可验收的内聚开发单元。

一个 task 应包含：

- 明确业务或技术闭环。
- ✅ 本 task 范围。
- ❌ 相关但不在本 task 范围。
- 来源需求位置。
- 散射组归属。
- 依赖 task。
- 主要所属 wave。
- 可验收结果 / 可提测性。

task 不应是：

- 文档章节的机械切片。
- 单个页面 / 单个接口的孤立碎片。
- 横跨太多无关业务域的大杂烩。

### Wave

wave 是版本级批次，用来组织多个 task 的提测 / 交付顺序。

一个 wave 应包含：

- `id`：如 `wave-1`
- `name`：如“核心链路首批提测”
- `goal`：这一批完成后测试能验什么
- `tasks`：纳入本 wave 的 task 列表
- `scope`：本 wave 的提测范围
- `prerequisites`：前置 task、外部系统或数据准备
- `done_when`：完成条件
- `testability`：可独立提测 / 依赖后续 wave / 仅前置能力

### Task 与 Wave 的关系

- 一个 task 默认归属一个主要 wave。
- 支撑类 task 可以标记为 `supports_waves`，说明服务哪些 wave。
- 一个 wave 通常包含多个 task。
- 只有用户明确要求时，才把 wave 拆成 parent / child task 结构。

## Artifact Shape

### 版本规划产物

默认路径：

```text
doc/
└── <版本>/
    ├── 需求清单.md
    ├── 任务拆分与waves.md
    └── 开发计划-工时评估.md
```

`任务拆分与waves.md` 建议结构：

```markdown
# <版本> 任务拆分与 Waves

## 拆分原则

## Task 候选列表
| Task ID | Task 名称 | 范围 | 不在范围 | 来源需求 | 散射组 | 依赖 | 主要 Wave | 可验收结果 |

## Wave 计划
| Wave | 目标 | 包含 Task | 提测范围 | 前置条件 | 完成条件 | 可独立提测 |

## 需求 -> Task -> Wave 覆盖矩阵
| 需求 | 来源位置 | 覆盖 Task | 所属 Wave | 状态 |

## 依赖关系
```

### 单 Task PRD

从版本规划中提取 task 时，单 task PRD 首屏建议包含：

```markdown
> 版本规划：doc/<版本>/任务拆分与waves.md
> Task 候选：TASK-001 <名称>
> 所属 Wave：wave-1 <名称>
> 来源需求：REQ-001 / REQ-002
```

### `task.json.meta`

单 task 可选写入：

```json
{
  "meta": {
    "version_plan": "doc/v1.2/任务拆分与waves.md",
    "wave": {
      "id": "wave-1",
      "name": "核心链路首批提测",
      "testability": "independent"
    },
    "source_requirements": [
      {
        "id": "REQ-001",
        "location": "doc/v1.2/需求清单.md:42"
      }
    ]
  }
}
```

## Skill Changes

### `trellis-plan-version`

职责：

- 扫描版本需求。
- 输出完整需求清单。
- 基于闭环、复用链、散射组、依赖和提测边界拆出内聚 task。
- 把 task 编排进 waves。
- 生成需求 -> task -> wave 覆盖矩阵。
- 等用户确认 task/wave 拆分后，再做工时评估和分工。

### `trellis-extract-prd`

职责：

- 从版本规划产物的 task 候选生成单 task PRD。
- PRD 继承 task 候选的范围 / 非范围 / wave 归属 / 来源需求。
- 散射追踪仍做，但不能扩大版本规划中已确认的 task 范围。
- 未提供版本规划时，按原始需求文档提取独立 task。

### `trellis-verify-task`

职责：

- 对单 task：校验 PRD 是否符合版本规划中的 task 边界和 wave 归属。
- 对版本规划：校验需求是否覆盖到 task，task 是否归入 wave，wave 是否可提测。
- 对三件套：校验 PRD / Design / Implement 中 wave 和 task 边界是否一致。

## Compatibility

- 不修改 `task.py` 标准字段。
- 不改变 task 状态。
- 不要求平台 hook 理解 wave。
- `trellis-continue` 仍按当前 task 状态和文件存在性恢复；wave 信息只作为规划和上下文。

## Rollout / Rollback

- 本次只改 skill 文档和任务规划文档。
- 如果未来需要“每个 wave 一个 parent / child task”，作为显式选项补充。
- 若 `task.json.meta.wave` 不合适，可停止写入；现有脚本会忽略未知 `meta` 字段。
