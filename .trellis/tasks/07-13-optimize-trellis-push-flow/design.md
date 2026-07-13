# 优化 Trellis 提交与推送流程设计

## Architecture

本任务保持现有职责分层：workflow 负责门禁，skill 负责语义与交互，Python runner 负责 auto-loop 的确定性状态，Git 操作仍由 `trellis-push` 统一组织。

```text
check-all / auto-loop runner
          |
          v
  Phase 3.4 trellis-push
          |
          +-- 生成精确计划与紧凑展示
          +-- 草拟/确认 commit message
          +-- 精确暂存并 commit
          +-- 普通模式 push / auto-loop commit-only
          +-- 写 snapshot / runner result
```

任何从 `check-all` 或主 agent 直接连到 `git commit` 的旁路都属于契约错误。

上游 workflow 下层 Phase 3.4 的 `Proposed commits` / local-only / no-push walkthrough 保留在上游正文中，但 skill-garden hub 和 in-progress state guard 必须明确将其整段标记为 inactive，由 `trellis-push` 完全替代；不能只依赖“高优先级”这一隐含关系。

## Scenario Matrix

| 场景 | 进入方式 | 默认 Git mode | 确认 | 结果 |
| --- | --- | --- | --- | --- |
| 普通 check-all 后续 | 保持 post-check stop；既有 Phase 3.3 完成后转交 `trellis-push` | push | 展示计划后确认一次 | commit + push |
| 用户直接运行 `trellis-push` | skill 入口 | push | 展示计划后确认一次 | commit + push |
| 用户明确只提交 | `trellis-push commit-only` | commit-only | 展示计划后确认一次 | 仅本地 commit |
| auto-loop | runner `profile=commit-only` | commit-only | 启动 run 时预授权，不二次确认 | 每个任务独立本地 commit |

普通 check-all 通过后仍按现有 post-check stop gate 停止并报告，不自动新增 Phase 3.3 执行。后续既有 Phase 3.3 完成并进入 Phase 3.4 时，必须转交 `trellis-push` 生成计划。只有 Git 写操作需要用户确认。

post-check 报告沿用 `check-all` 汇总结构，包含各维度状态、验证命令/结果、剩余风险、结论和下一步；输出后等待用户继续。该报告不得出现 commit message、planned files、`Proposed commits` 或提交确认提示。

最近一次 Spec review 的结果进入计划摘要：无修改时显示单行 no-op 结论；有修改时列出已更新的 spec 文件，并把这些文件纳入对应仓库的精确 planned files；无活动任务时显示跳过。

## Auto-loop State Contract

### Profile And Action

- 保留唯一 `profile=commit-only`，不新增 push profile。
- 保留现有 `commit_only` action，继续调用 `trellis-push` 的 auto-loop commit-only 预授权语义。
- `record` 成功时记录 planned/retained 文件摘要、commit message、work commit 和 snapshot/bookkeeping commit（如有）。
- 普通 `trellis-push` 的默认 push 变化不得改变 auto-loop runtime schema 或授权范围。

### Failure Semantics

- commit 失败：当前 item failed/blocked，不进入 push。
- 未识别 staged、冲突或文件无法归属：当前 item blocked；多任务队列继续后续 pending item。
- auto-loop 不执行远端 push，因此不存在自动创建 upstream 或 push 失败降级路径。

## Trellis-push Plan Presentation

计划模型始终保留完整字段：

- repo、branch、upstream、mode
- exact planned files
- exact retained/unrecognized files
- diff stat
- commit message
- push/merge/snapshot/bookkeeping plan

展示层分为：

- 小计划：每仓库不超过 8 个 planned files 时直接完整显示。
- 大计划：超过 8 个时按仓库/一级目录分组计数，文件区最多 12 行，并显示 diff stat 和代表性路径。
- 风险例外：unrecognized/staged/conflict/cross-task 文件始终逐项显示。
- 用户要求展开时，从同一份计划输出完整列表，不重新猜测文件范围。

执行前重新读取 Git 状态；任何 planned files 集合变化都使原计划失效。

### Recommended Terminal Layout

- 顶部摘要只展示 mode、仓库数、文件数、风险数和是否 push，让用户在第一行确认操作性质。
- 每个仓库使用一个扁平区块：commit message 优先显示，其次是 branch/upstream、diff stat 和文件摘要。
- Spec review、验证结果、snapshot 各压缩为一行；只有失败、部分完成或用户需要决策时展开详情。
- 空分组默认省略，不重复输出多行“无”；风险为零时只在顶部摘要显示一次。
- 未识别 dirty、staged、冲突、跨任务文件使用独立风险区块并逐项显示。
- 确认提示固定放在最后一行，同时给出少量可用调整指令，避免用户在长计划中寻找下一步。
- 执行完成后的结果复用相同顺序：结果摘要、各仓 commit/push、snapshot、保留未提交文件。

### Multi-repository Layout

- 顶部显示仓库数、独立 commit 数、文件总数、风险数和执行顺序。
- 每个仓库独立显示 commit message、branch/upstream、diff stat、planned files 摘要和 push mode。
- 普通模式对完整的多仓计划只确认一次；执行中只有计划漂移、仓库失败或新风险才重新停下。
- 任务级 Spec review、snapshot 和父仓 bookkeeping 放在所有业务仓库之后，避免被误认为某个业务仓库的内容。

### No-active-task Layout

- 顶部明确显示“无活动任务”，避免用户误以为存在 task snapshot 或归档上下文。
- 正常展示仓库、commit message、planned files、branch/upstream 和 push 动作。
- Spec review 显示“跳过（无活动任务）”；snapshot 和 task bookkeeping 同样明确跳过。
- 无任务不等于允许提交所有 dirty 文件；仍需区分当前会话可归属文件与无法识别来源的文件。
- 无法识别来源的 dirty 文件默认全部排除并完整展示；只有用户明确指定纳入范围后，才重新生成计划并进入确认。

## Commit Message Contract

- message 生成只能发生在 `trellis-push` 语义内部。
- 输入优先级：用户明确提供 > 任务材料与 diff > 最近提交风格。
- 普通模式：message 是确认计划的一部分。
- auto-loop：message 是预授权计划的一部分，执行后写入 decision summary。
- check/check-all 输出不得出现可直接执行的独立提交计划。

## Compatibility

- 保留 `commit-only` 自然语言入口和 snapshot 的 `push_mode=commit-only`。
- 普通 `trellis-push` 继续使用 `push_mode=push`；auto-loop 继续使用 `push_mode=commit-only`。
- auto-loop runtime 的 `commit_only` action 和 profile 保持不变。
- finish-work 根据 snapshot 的实际 `push_mode` 判断是否仍有本地 ahead commit，避免已经 push 后重复或遗漏提示。

## Source And Sync Boundaries

主要源文件预计包括：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- 对应 `.claude` skill 副本
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- 必要的 workflow-state override

同步后更新：

- `enhancements/0.6/**`
- 当前 `.agents/skills/**` 与 `.claude/skills/**`
- 当前 `.trellis/workflow.md`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`

## Rollout And Rollback

- Rollout：先改 vendor skill/workflow 源，运行 `npm run sync`，同步 dogfood 副本，再执行普通流程与 auto-loop commit-only 回归验证。
- Rollback：回退 `trellis-push` 展示和 post-check transition 文案；auto-loop runner schema 不发生变化，无 runtime 迁移要求。
