# 增加任务启动交接摘要

## Goal

在任务从 planning 切到 in_progress 时提供轻量任务交接摘要，降低人和 agent 重新细读三件套的成本。

## Background

当前 Trellis 在 `task.py start` 后会把任务状态切到 `in_progress`，后续由 agent 按规则读取 `prd.md`、`design.md`、`implement.md`。这个流程在正确性上可行，但在人机体验上有断点：任务真正进入实现阶段时，用户和主 agent 往往不知道“这轮到底要做什么、边界是什么、第一步是什么”，需要重新仔细阅读三件套。

本任务希望补上 planning -> in_progress 的交接层。交接摘要必须是三件套的索引和压缩视图，不能替代三件套，也不能成为新的权威需求来源。

## Confirmed Facts

- `task.py start` 会写当前会话的 active task 指针，并把 `task.json.status` 从 `planning` 切到 `in_progress`。
- SessionStart 与 workflow-state 已经会注入当前任务状态，但目前主要告诉 agent 处于哪个阶段、下一步怎么走，不提供任务内容摘要。
- 现有 workflow 要求实现/检查时按 `prd.md`、`design.md if present`、`implement.md if present` 读取上下文。
- 轻量 skill 可以指导 agent 生成、校验或展示交接摘要，但 workflow-state 本身只是注入文本，不会像 hook/script 一样自动执行 skill。

## Requirements

- 在任务从 planning 切到 in_progress 前后，提供一个短小、稳定、可快速扫读的任务交接摘要。
- 交接摘要正文存储在任务目录下的 `brief.md`。
- `task.json.meta` 不存储完整交接摘要正文；如后续需要自动注入或过期检测，仅允许存放 `brief_path`、`brief_updated_at`、`brief_source_hash`、`brief_status` 等轻量索引字段。
- 摘要应覆盖：
  - 任务目标一句话。
  - 本轮实现范围。
  - 明确不做的范围。
  - 关键文件、模块或入口。
  - 主要验收标准。
  - 推荐下一步动作。
- 摘要必须能追溯到 `prd.md`、`design.md`、`implement.md`，不得引入三件套没有表达的新需求。
- 每次运行 `trellis-task-brief` 都必须重新读取当前任务目录下最新的 `prd.md`、`design.md if present`、`implement.md if present`，并据此更新 `brief.md`；不得只因为 `brief.md` 已存在就跳过同步。
- `brief.md` 是派生产物；当三件套更新后，下一次运行 skill 必须以三件套为准覆盖或修正过期内容。
- `trellis-task-brief` 更新 `brief.md` 后，必须在当前对话中直接展示 brief 内容，不能只提示用户去文件里查看。
- 对话内展示应遵循“信息完整优先、避免无意义展开”的原则：不得为了省 token 截掉关键范围、约束或验收条件；进入 `in_progress` 后的重述可以压缩，但必须保留会影响执行判断的要点。
- Phase 1.4 `task.py start` 前的 review 必须包含对话内 brief 展示；用户确认 planning artifacts 和 brief 后才能启动任务。
- 任务进入 `in_progress` 后，主 agent 在执行 implement route 前应先基于 `brief.md` 在对话里重述任务交接摘要，让用户和 agent 都能看到当前任务要做什么。
- 摘要缺失或过期时，agent 必须回到三件套读取，不能凭摘要猜测。
- 支持轻量任务 PRD-only；复杂任务应从三件套生成更完整摘要。
- 方案应兼容 Codex / Claude 当前 Trellis 工作流，至少覆盖 `.agents` 与 `.claude` 入口。
- 若引入 skill，skill 应是轻量入口：负责生成/校验/展示 brief，不把所有 workflow 规则复制进去。
- 第一版新增轻量 skill，并在 Phase 1.4 `task.py start` 前生成/校验 `brief.md`；任务已进入 `in_progress` 后如果发现 `brief.md` 缺失，只提示回到三件套并补生成，不自动生成未经 review 的摘要。
- 若希望自动出现在 SessionStart 或 workflow-state 上下文里，应通过 hook/script 或工作流注入机制读取 brief，而不是假设 skill 会自动执行。

## Candidate Design Directions

1. `brief.md` / `handoff.md` 文件
   - 优点：可读、可 review、适合复杂任务。
   - 缺点：又多一个任务文件，需要维护漂移。

2. `task.json.meta.implementation_brief`
   - 优点：机器读取和注入简单，适合 SessionStart / workflow-state。
   - 缺点：长文本放 JSON 可读性差，人工编辑体验一般。

3. 轻量 skill，例如 `trellis-task-brief`
   - 优点：低侵入，可按需生成或校验摘要，也可在 Phase 1.4 start review 前调用。
   - 缺点：只靠 skill 不能保证自动注入；仍依赖 agent 执行。

4. hook/script 自动生成或读取 brief
   - 优点：最稳定，能在 SessionStart / task-status 中展示。
   - 缺点：实现复杂度更高，需要处理生成时机、过期检测和跨平台同步。

## Recommended Direction

第一版推荐使用 `brief.md` 作为交接摘要的权威存储；`task.json.meta` 最多存机器索引或缓存字段，例如 `brief_path`、`brief_updated_at`、`brief_source_hash`、`brief_status`，不存完整正文。

理由：

- 交接摘要虽然短，但仍是人需要 review 的任务交付物；Markdown 比 JSON 更适合人工编辑、diff 和评审。
- `task.json` 当前更像生命周期和元数据容器；把多行自然语言正文塞进 `meta` 会让文件变吵，也容易引入转义和格式 churn。
- `brief.md` 与现有 `prd.md` / `design.md` / `implement.md` 的任务文件模型一致，skill 生成和校验时也更自然。
- 后续若需要 SessionStart 自动注入，可以让 hook/script 读取 `brief.md`；不必为了注入便利提前把正文放进 `task.json`。
- `task.json.meta` 适合放轻量状态，帮助判断 brief 是否存在、是否过期、是否来自当前三件套版本。

## Acceptance Criteria

- [x] 明确选择交接摘要的存储位置：任务目录下的 `brief.md` 作为权威交接摘要。
- [x] 明确是否新增轻量 skill，以及该 skill 的触发时机和职责边界。
- [ ] Phase 1.4 `task.py start` 前的 review 流程能提示或生成交接摘要。
- [ ] 任务进入 `in_progress` 后，SessionStart 或 workflow-state 能展示摘要或明确提示摘要缺失并要求读取三件套。
- [ ] `brief.md` 更新后会直接显示在对话里，用户不需要打开文件才能看到交接摘要。
- [ ] 从 planning 切到 `in_progress` 后，主 agent 在 implement route 前会在对话里重述 `brief.md` 摘要。
- [ ] 对话展示以不失真为优先：start review 展示完整 brief；`in_progress` 重述可压缩，但不能丢失影响实现判断的范围、约束和验收条件。
- [ ] `trellis-task-brief` 每次运行都会读取最新三件套并更新 `brief.md`；已有 `brief.md` 不会阻止同步。
- [ ] 摘要字段固定且短小，避免变成第四件套。
- [ ] 摘要不得覆盖三件套权威性；发现冲突时以三件套为准，并提示修正摘要。
- [ ] 更新相关 `.agents` / `.claude` / `.trellis/workflow.md` / hooks 或 scripts 时保持语义一致。
- [ ] 有验证方式证明：新建 PRD-only 任务、复杂三件套任务、无摘要旧任务都能正常进入下一步。

## Out Of Scope

- 不重构整个 Trellis 任务生命周期。
- 不把 PRD / design / implement 合并成单文件。
- 不要求所有历史任务补齐摘要。
- 不用摘要绕过实现前的上下文读取和 spec 读取。

## Decisions

- 使用任务目录下的 `brief.md` 作为权威交接摘要。
- 新增轻量 skill，用于根据最新三件套生成/更新/校验/展示 `brief.md`。
- 第一版只在 Phase 1.4 `task.py start` 前要求生成/校验 `brief.md`。
- `brief.md` 必须展示在对话里，作为 start review 的一部分；不能只写文件。
- `in_progress` 阶段发现 `brief.md` 缺失时，不自动补生成；必须提示读取三件套，并建议回补 brief。

## Notes

- 当前方案：先做轻量 skill + `brief.md`，并在 workflow-state / Phase 1.4 文案中要求 start 前生成或校验；如果体验仍不够稳定，再把读取 `brief.md` 接入 SessionStart / task-status 自动注入。
