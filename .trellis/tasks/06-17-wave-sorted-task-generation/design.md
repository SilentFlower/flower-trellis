# 按 Wave 排序版本 Task 创建设计

## Technical Design

本任务只调整 Trellis 技能文档对版本 task 生成的约束，不修改 `task.py` 的创建逻辑。排序语义来源于版本规划产物，具体 task 目录的自然排序通过 slug 命名规范体现。

## Boundary

### 修改对象

- `.agents/skills/trellis-plan-version/SKILL.md`
- `.agents/skills/trellis-extract-prd/SKILL.md`
- `.agents/skills/trellis-verify-task/SKILL.md`
- `.claude/skills/` 下同名 skill 副本
- `enhancements/0.6/` 下 `.agents` 与 `.claude` 同名 skill 副本
- `vendor/skill-garden/.trellis/0.6/` 下 `.agents` 与 `.claude` 同名 skill 副本

### 不修改对象

- `.trellis/scripts/task.py`
- `.trellis/scripts/common/task_store.py`
- task 状态机和 active-task 机制
- 0.5 skill 副本

## Sorting Model

版本规划产物增加“Task 创建顺序”作为 `Task 候选列表` 和 `Wave 计划` 之间的桥接视图。

排序规则：

1. 先按 wave 排序。
2. 同一 wave 内按 task 依赖排序，前置能力在前。
3. 无依赖关系时，按可提测闭环优先级、风险或用户确认的顺序排序。
4. 跨 wave 支撑 task 放在它服务的首个 wave 前，或明确标记为跨 wave 前置项。

建议表结构：

```markdown
### Task 创建顺序

| 创建序号 | Wave | Wave 内序号 | Task ID | Task 名称 | Slug 建议 | 排序原因 |
|----------|------|-------------|---------|-----------|-----------|----------|
```

## Slug Model

推荐 slug 结构：

```text
<version>-wNN-tNN-<task-slug>
```

设计理由：

- `task.py create` 会自动添加 `MM-DD-` 日期前缀，slug 不需要也不应该包含日期。
- `wNN` 让同一 wave 的 task 在目录自然排序中聚合。
- `tNN` 保留全版本创建顺序，避免同 wave 内顺序不稳定。
- `<task-slug>` 保留业务语义，便于人工识别。

示例命令：

```bash
python3 .trellis/scripts/task.py create "项目列表反馈投标状态" \
  --slug "srm-iqs-v141-w01-t01-project-list-feedback-bid-status"
```

## Skill Changes

### `trellis-plan-version`

- 在 Step 4.3 输出结构中加入“Task 创建顺序”。
- 明确 task 候选列表可以保留分析顺序，但创建具体 task 必须以“Task 创建顺序”为准。
- 增加反模式：生成 task 创建顺序时让同一 wave 被拆散。

### `trellis-extract-prd`

- 在输入和执行步骤中补充批量生成场景。
- 当版本规划产物存在“Task 创建顺序”时，批量创建必须按该顺序执行。
- 写明 slug 建议和 `task.py create --slug` 示例。
- 单个 Task ID 提取仍保持原行为，不强制批量。

### `trellis-verify-task`

- 在版本规划覆盖校验中增加“task 创建顺序 / 目录排序”检查。
- 校验版本规划产物中的“Task 创建顺序”是否满足 wave 连续性。
- 如能读取实际 task 目录和 `task.json.meta.wave`，检查同一版本下同 wave task 是否被其他 wave 插开。

## Compatibility

- 旧版本规划产物没有“Task 创建顺序”时，校验应提示补充，而不是假装失败到无法继续。
- 已创建的旧 task 不要求重命名。
- `task.json.meta.wave` 仍是可选元数据；没有该字段时，实际目录排序校验只能降级为版本规划文档校验。

## Rollback

本任务只改文档型 skill。若模型不合适，回滚对应 `SKILL.md` 改动即可，不涉及数据迁移。
