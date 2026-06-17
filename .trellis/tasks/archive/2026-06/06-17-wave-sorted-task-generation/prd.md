# 按 Wave 排序版本 Task 创建

## Goal

让基于版本规划生成具体 task 时按 wave 聚合排序，避免同一 wave 的任务在目录中分散。

## Background / Known Context

- 现有版本规划模型已经定义：wave 是版本级提测 / 交付批次，不是 `task.py` 状态，也不是独立 task 生命周期。
- `trellis-plan-version` 负责生成内聚 task 候选与 wave 编排。
- `trellis-extract-prd` 负责从版本规划中的 task 候选生成单 task PRD，并补充 `task.json.meta.wave`。
- `trellis-verify-task` 负责校验单 task PRD、版本规划、task / wave 覆盖关系是否一致。
- 当前问题来自实际使用：版本 task 目录按创建顺序或 Task ID 展示时，同一 wave 的 task 可能被其他 wave 插开，不利于查看批次进度。

## Problem

当前版本规划产物虽然能表达每个 task 的 wave 归属，但“生成具体 task”时缺少明确排序规则：

- task 候选可能按需求文档顺序、Task ID 顺序或人工创建顺序生成。
- 同一 wave 的 task 在 `.trellis/tasks/` 目录中可能不连续。
- 后续开发者只看目录列表时，很难快速判断哪些 task 属于同一提测批次。
- 如果让 `task.py create` 自己解析 wave，会把版本规划语义塞进通用 task 生命周期脚本，增加不必要耦合。

## Requirements

- `trellis-plan-version` 必须在版本规划产物中输出明确的 task 创建顺序。
- task 创建顺序必须优先按 wave 分组：同一 wave 的 task 连续出现。
- 同一 wave 内部再按依赖、可提测闭环、风险或用户确认的优先级排序。
- 跨 wave 支撑 task 必须明确放置规则：放在它服务的首个 wave 之前，或单独标记为跨 wave 前置项。
- `trellis-extract-prd` 批量生成具体 task 时，必须按版本规划中的 task 创建顺序执行。
- 生成 task slug 时应支持稳定排序键，使目录自然排序也能体现 wave 分组。
- `trellis-verify-task` 必须校验版本规划中的 task 创建顺序与 wave 归属一致。
- 如已有具体 task 目录和 `task.json.meta.wave`，`trellis-verify-task` 应能发现同一 wave 被其他 wave 插开的排序问题。
- 保持 `task.py create` 通用，不新增 wave 参数、不解析版本规划文档、不改变 task 状态机。

## Proposed Default

默认采用显式排序 slug。用户已确认接受该策略：

```text
<version>-wNN-tNN-<task-slug>
```

示例：

```text
srm-iqs-v141-w01-t01-project-list-feedback-bid-status
srm-iqs-v141-w01-t02-export-full-order-notify
srm-iqs-v141-w02-t03-bid-result-material-flag
```

`task.py create` 会自动添加 `MM-DD-` 日期前缀，所以最终目录名会类似 `06-17-srm-iqs-v141-w01-t01-project-list-feedback-bid-status`。这样即使 UI 只按目录名排序，也能让同一 wave 聚在一起。

## Acceptance Criteria

- [x] `trellis-plan-version` 的 `任务拆分与waves.md` 模板包含“Task 创建顺序”章节。
- [x] “Task 创建顺序”明确按 wave 分组，并说明 wave 内排序依据。
- [x] `trellis-extract-prd` 明确要求批量创建 task 时按“Task 创建顺序”执行。
- [x] `trellis-extract-prd` 给出 wave-aware slug 命名规范，并说明 `task.py create --slug` 不要包含日期前缀。
- [x] `trellis-verify-task` 增加 task 创建顺序 / 目录排序校验。
- [x] 改动同步到 `.agents`、`.claude`、`enhancements/0.6`、`vendor/skill-garden/.trellis/0.6` 的对应 skill 副本。
- [x] 不修改 `task.py` 生命周期逻辑，不新增 wave 状态或命令。

## Out of Scope

- 不开发自动批量创建 task 的新 CLI 命令。
- 不改变 `.trellis/tasks/` 顶层目录按日期前缀创建的规则。
- 不强制旧 task 目录重命名。
- 不把 wave 变成 parent / child task 结构。
- 不处理 0.5 版本的 skill 副本，除非后续确认需要回填。

## Open Questions

- 无。

## Decisions

- 采用默认 slug 命名规范 `<version>-wNN-tNN-<task-slug>`，用于让 `.trellis/tasks/` 目录自然排序时按 wave 聚合。

## Validation Notes

- `git diff --check`：通过。
- `git -C vendor/skill-garden diff --check`：通过。
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`：通过。
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-17-wave-sorted-task-generation`：通过。
- 0.6 skill 副本一致性 diff：通过。
- `node scripts/check-snapshot.mjs`：因 `enhancements/` 存在未提交快照改动失败，符合发布前门禁预期；提交快照后可通过该门禁。
- Phase 3.1 check-all：通过；未发现规划偏差、假设错误、漏同步或生命周期脚本误改。
