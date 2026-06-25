# Design — 增加任务启动交接摘要

## Architecture

本任务引入一个轻量交接层：

1. `brief.md`：任务目录下的权威交接摘要，由 planning 阶段生成并由用户 review。
2. `trellis-task-brief` skill：负责从最新 `prd.md`、`design.md`、`implement.md` 生成、更新、校验、展示 `brief.md`。
3. workflow 文案：在 Phase 1.4 `task.py start` 前要求生成/校验 `brief.md`；在 `in_progress` 阶段发现缺失时提示读取三件套并回补，不自动生成未经 review 的 brief。

`brief.md` 不替代三件套。实现和检查仍必须按现有规则读取 `prd.md`、`design.md if present`、`implement.md if present`。

`brief.md` 不是只给人手动打开的文件。每次 `trellis-task-brief` 更新它后，都必须把 brief 正文直接展示在当前对话中；Phase 1.4 的 start review 必须包含这段对话内摘要。

对话展示必须以不失真为优先。Phase 1.4 start review 展示完整 brief；进入 `in_progress` 后可以重述压缩版并附 `brief.md` 路径，但不能丢掉会影响实现判断的范围、约束、风险和验收条件。

## `brief.md` Contract

建议模板：

```markdown
# Brief — <任务标题>

## Goal

- <一句话说明任务目标>

## Scope

- <本轮要做的事情>

## Non-Goals

- <本轮明确不做的事情>

## Key Context

- <关键文件、模块、入口或约束>

## Acceptance

- <主要验收标准>

## Next Step

- <进入 in_progress 后第一步>
```

约束：

- 内容必须来自 `prd.md`、`design.md`、`implement.md`。
- `brief.md` 是三件套的派生产物；每次运行 skill 都必须重新读取最新三件套并更新它。
- 已存在的 `brief.md` 不能作为跳过同步的理由，只能作为需要被最新三件套校正的旧版本。
- 未在三件套表达的内容不能写成新需求。
- 如果 brief 与三件套冲突，以三件套为准，并修正 brief。
- brief 应保持短小；目标是任务交接，不是第四件套。
- brief 应避免复制三件套大段内容，但不得机械截断；复杂任务应保留会改变实现判断的范围、约束、风险和验收条件，并链接回三件套承载细节。

## Skill Design

新增 project-local skill：`.agents/skills/trellis-task-brief/SKILL.md`，并同步到 `.claude/skills/trellis-task-brief/SKILL.md`。

职责：

- 识别当前 task 或用户指定 task。
- 读取 `prd.md`、`design.md if present`、`implement.md if present`。
- 每次运行都基于最新三件套生成新的 brief 内容，并写回 `brief.md`。
- 校验写回后的 `brief.md` 是否覆盖固定字段、是否明显偏离三件套。
- 写回后立即在对话里展示完整 brief 正文。
- 在 Phase 1.4 前向用户展示 brief，并要求确认 planning artifacts 和 brief 后再 `task.py start`。
- 在 `in_progress` 阶段缺失 brief 时，提示读取三件套并建议回补；不自动创建未经 review 的 brief。

非职责：

- 不执行 `task.py start`。
- 不修改三件套需求。
- 不替代 `trellis-brainstorm`。
- 不作为自动 hook；自动注入属于后续增强。

## Skill Update Algorithm

`trellis-task-brief` 每次运行按固定顺序执行：

1. 解析任务路径：优先使用用户指定路径，否则运行 `python3 ./.trellis/scripts/task.py current --source`。
2. 读取最新任务文件：`prd.md` 必读，`design.md` 和 `implement.md` 存在则读取。
3. 从三件套提取 `Goal`、`Scope`、`Non-Goals`、`Key Context`、`Acceptance`、`Next Step`。
4. 生成完整 `brief.md` 内容。
5. 如果 `brief.md` 已存在，也用最新内容覆盖旧正文；不做“已存在则跳过”。
6. 写回后向用户展示完整 brief 正文，并说明来源文件。

覆盖策略：

- 旧 brief 中无法从三件套追溯的内容不保留。
- 若三件套缺少某字段，brief 对应字段写“未明确”，并提示应回到三件套补充，而不是在 brief 里发明内容。
- 如果用户手工编辑过 `brief.md`，下一次运行 skill 仍以三件套为准；需要保留的内容必须先写回三件套。

## Conversation Display Contract

Phase 1.4 start review 时，主 agent 应在对话中展示：

```markdown
任务交接摘要已更新：<task>/brief.md

<brief.md 正文>

请确认 planning artifacts 和上述 brief；确认后才运行 `task.py start <task>`。
```

任务切到 `in_progress` 后，在进入 `trellis-route(implement)` 前，主 agent 应读取 `brief.md` 并在对话中简短重述：

```markdown
当前任务 brief：<目标一句话>
范围/约束：<不失真的压缩要点>
验收：<不失真的压缩要点>
完整摘要：<task>/brief.md

下一步：进入 `trellis-route(implement)`。
```

如果 `brief.md` 缺失，不应静默继续；应提示“brief 缺失，先读取三件套，并建议回到 planning 补生成 brief”。第一版不在 `in_progress` 阶段自动生成未经 review 的 brief。

## Workflow Changes

修改 `.trellis/workflow.md`：

- Phase 1.4 说明中加入：start 前调用/使用 `trellis-task-brief` 生成或校验 `brief.md`。
- `[workflow-state:planning]` 加入短提示：start 前需要 review planning artifacts，并在对话中展示 `brief.md`。
- `[workflow-state:in_progress]` 加入短提示：implement route 前先在对话中重述 `brief.md`；如果任务缺少 `brief.md`，不得凭记忆继续，读取三件套并建议回补 brief。

如果当前项目通过 skill-garden 源和 `enhancements/0.6` 管理 workflow 文案，实施时需要同步源、快照和本地副本，避免下一次 sync 覆盖。

## Context Manifests

本任务实现涉及 Trellis CLI / workflow / skill 文件，应在 `implement.jsonl` 和 `check.jsonl` 中放入：

- `.trellis/spec/flower-trellis/cli/index.md`
- `.trellis/spec/guides/index.md`

代码路径不放入 jsonl，实施阶段直接读取。

## Compatibility

- 旧任务没有 `brief.md` 时仍可继续，但 workflow 应提示读取三件套并建议回补。
- PRD-only 轻量任务可生成简短 brief。
- 复杂任务从三件套生成 brief。
- 不要求历史任务批量迁移。

## Trade-offs

- `brief.md` 增加一个任务文件，但换来可读、可 review、低风险的交接层。
- 第一版不做自动 SessionStart 注入，可靠性不如 hook 方案，但实现简单，不会把未经 review 的摘要塞入执行上下文。
- `task.json.meta` 暂不承载正文，避免污染生命周期元数据。

## Rollback

回退时删除新增 skill 和 workflow 文案改动即可。已有任务的 `brief.md` 是普通任务文档，保留或删除都不影响任务生命周期。
