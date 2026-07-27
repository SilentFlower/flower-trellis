# 升级 Auto-Loop 无人值守执行

## Goal

把 auto-loop 从“任务执行自动化、规划交接仍逐项等待确认”升级为真正的批量无人值守执行：用户发出启动指令即完成本次 run 授权，runner 完成全队列 prepare 后推进到终态，不再因每个 planning 任务的 `confirm_brief`、route 选择或普通 Check-All 停止边界反复等待用户。

## Background

- 当前 runner 会把显式任务列表全部入队，但 planning start gate 在任务轮到时才惰性执行。
- 每个 planning 任务必须依次经过内容绑定的 readiness review、brief 刷新和 `confirm_brief` 显式确认，因此多任务队列无法真正无人值守。
- 当前 `commit-only` 已证明 run 级预授权模型可行：用户启动 auto-loop 后，AI 仍执行逐任务安全自检，但不再进行二次聊天确认。
- 历史 brief 门禁用于防止“只凭文件存在就启动”和“批准旧内容、执行新内容”；升级不能丢失这两个安全目标。
- runner 已支持单项 blocked 后继续后续任务、同 run `retry-blocked`、action 精确回写和 artifact hash 失效检测。

## Requirements

### R1. 批量启动预检

- `start` 后、执行首个任务前，对显式队列中的全部任务生成结构化预检结果，而不是只检查当前或首个任务。
- 预检至少覆盖任务存在性、允许的 task status、planning artifacts 完整性、Open Questions、route/context 准备度、planning semantic readiness 和 brief freshness。
- 一次性汇总所有可确定 blocker，避免运行到后续任务才暴露启动条件问题。
- 对人工拥有的 Open Questions，prepare 必须汇总任务、问题文本和来源位置，并进入引导处理流程，不能只给 blocked reason 后结束。
- 引导流程按问题逐项获取人工答案，更新对应 planning artifacts 后重新预检；所有人工问题收敛后才生成最终 manifest。
- 队列中任一任务存在未解决 Open Questions 时，整个 run 保持在 prepare/awaiting-input 阶段；不得先执行其它任务。
- running 阶段不再出现逐任务 planning 确认或 Open Questions 提问，保证执行阶段真正无人值守。

### R2. Run 级规划授权

- 用一次 run 级授权替代逐任务 `confirm_brief`。
- 用户明确发出“开始 auto-loop”及等价指令时，即构成对随后生成的整批 run manifest 的预授权，不再要求 prepare 完成后的二次确认。
- 该预授权允许 AI 基于队列中现有 planning artifacts 执行语义 readiness review、刷新派生的 `brief.md`、固化 hash 并开始执行，但不得据此猜测未表达的产品需求。
- 授权必须绑定任务顺序、每个任务的 authoritative planning artifacts 与 `brief.md` 联合摘要、route 策略、check depth 和 profile。
- 已授权且摘要未变化的任务轮到时直接进入 `start_task`，不得再次等待用户。
- runner 必须保存授权来源、授权时间、manifest 摘要和逐任务 handoff 摘要，确保该授权仅作用于本次 run。

### R3. 无人值守终态

- 单项可恢复问题默认只阻塞该项并继续后续任务，队列不得因普通任务级 blocker 停在等待聊天输入的中间态。
- 需求存在多个合理选项时，允许 AI 在预授权边界内自主选择推荐方案并继续执行，而不是默认把所有产品歧义都转为 blocked。
- 队列最终必须进入 `completed`、`completed_with_blocked` 或等价可审计终态，并输出每项结果与恢复方式。
- 只有仓库不可读、runtime 损坏、Git 冲突/未完成集成、用户显式 stop 或其它全局安全边界可以停止整个 run。
- auto-loop 继续以本地 `commit-only` 为执行终点，不自动移动或归档任务目录。
- 队列运行完成不隐含 `trellis-finish-work`、archive、push、merge、release 或 deploy 授权。
- 成功队列项的 `completed` 只表示本地提交完成；对应 Trellis 任务继续保持 `task.json.status=in_progress`，直到用户后续显式执行 finish/archive。
- auto-loop 不新增“原地 completed”状态转换，也不为了同步生命周期状态修改或提交 `task.json`。

### R4. AI 决策与审计日志

- AI 决策采用“默认授权 + 高风险黑名单”：满足任务目标内、仅影响本地代码、可逆、可测试验证等条件时允许自主选择。
- 可自主决定的典型事项包括实现细节、默认交互、不改变目标的需求补全，以及仓库证据明显支持其中一个方案的选择。
- 以下决策必须强制 blocked：不可逆真实数据修改；扩大权限或降低安全/隐私保护；公开 API 或数据格式破坏性变更；费用、生产环境或外部系统影响；push、merge、release、deploy、归档；明显改变任务目标或业务规则且仓库无倾向证据。
- `## Open Questions` 是人工拥有的显式决策边界，不适用 AI 默认自主授权。
- 存在 `- [ ]` 未解决项时，AI 不得自行选择、删除、改写或勾选；整个 run 保持在 prepare/awaiting-input，由主会话引导人工处理全部问题。
- `- [x]` 表示人工已经解决；章节缺失或为空表示没有人工保留问题，AI 才可按其余自主决策规则继续。
- 历史裸列表不得由 AI 自动解释为已解决；prepare 应将其报告为需要人工规范化的 Open Questions 状态。
- AI 自主决策必须是显式的 runner 事件，不得只存在于聊天内容或模型内部推理中。
- 决策事件至少记录：任务、决策主题、候选方案、最终选择、简短依据、证据来源、风险等级、置信度、影响的 requirement/artifact/file、时间和后续验证结果。
- 日志只保存可审计结论和证据摘要，不记录模型思维链。
- `status/resume --verbose` 必须能查看决策事件；run 完成摘要应列出自主决策数量和较高风险决策索引。
- artifact 因自主决策而更新时，runner 必须重新计算 planning/handoff hash，并把新摘要与对应决策事件绑定，不能沿用旧 manifest 授权。
- 后续人工 review 应能选择接受全部或按决策 ID 要求返工。
- run runtime 保存当前队列的实时决策摘要；每个发生自主决策的任务在任务目录持久化 `decisions.jsonl`。
- `decisions.jsonl` 随该任务的最终精确本地提交进入 Git；runtime 被清理后仍可通过任务目录和 Git 历史审计。
- 后续人工归档任务时，`decisions.jsonl` 随任务目录自然进入 archive，不需要 auto-loop 执行额外同步。

### R5. 内容漂移保护

- run 授权后任一 planning/handoff artifact 变化，当前 manifest revision 自动失效。
- AI 在已授权决策边界内修改 planning artifacts 时，必须通过决策事件生成新的 manifest revision，而不是覆盖旧 revision 或把变化误判为外部漂移。
- 无对应决策事件的 artifact 变化视为外部漂移，当前项进入稳定 reason 的 blocked，并继续队列。
- 默认不得让 AI 无边界地改变目标、扩大权限或引入外部副作用后自行批准。

### R6. Planning 自动修复

- 除人工拥有的 Open Questions 外，prepare 允许 AI 修复可从现有需求、代码、spec 和仓库证据中确定的 planning 问题。
- 可修复范围包括 brief 缺失/过期、JSONL context 未整理、验收标准不可测试、design/implement 不完整，以及其它不改变任务目标的 planning 质量问题。
- 每个任务最多执行 3 轮 planning repair；每轮必须记录修改文件、修复原因、证据和新的 artifact hash。
- 3 轮后仍未达到 readiness，或修复需要越过 AI 决策黑名单时，当前任务进入稳定 reason 的 blocked。

### R7. Route 与检查连续性

- 启动前为整批任务解析可复用的 route 策略，避免切换任务时再次询问。
- validated auto-loop 的 Check-All 必须继续执行 `record + next`，不得进入普通交互式停止门禁。
- fix/recheck 预算耗尽、spec update `needs-review`、commit-only 文件无法归属等任务级失败必须结构化记录并继续队列。
- 可恢复失败在当前任务内立即重试，planning repair 与实现 fix/recheck 各自遵守最多 3 轮预算。
- 当前任务预算耗尽后立即标记 blocked 并继续后续任务；队列结束后不执行第二遍恢复扫描。
- `retry-blocked` 继续作为 run 结束后由用户显式触发的恢复入口，不由无人值守模式自动调用。

### R8. 任务依赖

- 多任务队列支持显式依赖关系；任务排列顺序只决定调度顺序，不隐含依赖。
- prepare 必须把依赖关系固化到 run manifest，并在 running 前检查循环依赖、缺失依赖和非法自依赖。
- 用户顺序与显式依赖冲突时，prepare 自动执行稳定拓扑排序：只移动满足依赖所必需的任务，无依赖任务保持原始相对顺序。
- 重排后的队列、原始队列和每项移动原因写入 manifest 与审计事件；进入 running 后顺序冻结。
- 前置任务失败或 blocked 时，只把显式依赖它的后续任务标记为 `blocked-dependency`；无依赖任务继续执行。
- 依赖传播必须保存直接失败来源和完整依赖链摘要，方便后续 review/retry。
- 依赖失败是任务级终态，不得停止整个队列。

### R9. 兼容性与可审计性

- 保持旧 auto-loop runtime 的兼容读取；新增授权数据必须有 schema version 和稳定迁移策略。
- `status/resume --verbose` 能展示批量预检、授权摘要、漂移原因和每项终态；默认输出继续保持紧凑。
- 不记录模型思维链，只保存结论、摘要、hash、策略、原因和必要文件列表。
- 规则继续由 runner、`trellis-auto-loop` skill 和既有 workflow owner 分层承载，避免把完整逻辑复制进高频上下文。
- `trellis-auto-loop` 最终 canonical SKILL 必须纳入上下文预算：以当前 `15,600 bytes / 220 lines` 为基线，target 为 `16 KiB`，review ceiling 为 `18 KiB`；超过 target 必须说明增长并优先去重，超过 review ceiling 时 strict checker 必须失败。
- 新状态字段、JSON schema、确定性校验和错误矩阵优先下沉到 runner/helper；SKILL 只保留语义边界、交互职责和 action 调度说明，并通过替换旧流程控制体积，不能叠加重复的 schema 1/schema 2 正文。
- 后续手动执行 finish/archive 时，如果任务存在未审查的 `decisions.jsonl`，必须先展示决策摘要并等待一次显式 review。
- review 支持一次性接受全部决策，或按决策 ID 指定返工；接受后记录 `reviewed_at`、review verdict 和必要备注。
- 未完成决策 review 的任务不得归档；没有自主决策的任务不增加额外确认步骤。

### R10. Dirty Baseline 与提交归属

- prepare 不要求工作区整体干净，但启动前必须确认 staged 区为空、无冲突且不存在 merge/rebase/cherry-pick/revert 等未完成 Git 集成状态。
- 能明确归属于队列任务的既有改动进入对应任务 manifest；无法归属或属于其它工作的改动记录路径与内容摘要，并标记为 `protected-retained`。
- auto-loop 不得修改、暂存或提交 `protected-retained` 文件；若当前任务必须修改同一文件，只阻塞该任务，其他任务继续。
- 每次 commit-only 继续使用 exact files；禁止 `git add .`、`git add -A` 或基于时间差/dirty baseline 猜测归属。
- protected 文件内容在 run 中发生非预期变化时必须记录漂移并停止涉及该文件的任务，不能覆盖用户改动。

## Preliminary Design Direction

推荐采用两阶段模型：

1. `prepare`：全队列预检、集中处理 Open Questions、AI readiness review、刷新全部 brief，生成带摘要的 run manifest revision。
2. `run`：复用启动指令的 run 级预授权，runner 保存每项 handoff hash，随后逐项自动执行。

建议新增类似以下状态：

```text
preparing -> awaiting_input -> preparing -> running
          -> completed | completed_with_blocked | globally_blocked | stopped
```

planning 任务不再返回逐项 `confirm_brief`；它校验当前 hash 与 manifest 一致后直接 `start_task`。不一致时当前项进入 `artifact-drift`，队列继续。

## Acceptance Criteria

- [ ] 用户启动指令构成唯一 run 级授权；多个 planning 任务在执行期间不再逐项返回 `confirm_brief`。
- [ ] 启动执行前可看到全队列预检结果，不会只验证第一个任务。
- [ ] 授权绑定任务顺序和每项 handoff hash；内容漂移不能沿用旧授权。
- [ ] 允许 AI 在明确边界内自主处理需求歧义，并把每次选择保存为结构化决策事件。
- [ ] 自主决策同时存在于 runtime 摘要和任务内 `decisions.jsonl`，后者随最终本地提交持久化。
- [ ] 存在未审查自主决策时，finish/archive 在归档前展示摘要并等待一次 review；无决策任务不受影响。
- [ ] Open Questions 在执行前由批量 prepare 汇总并引导人工逐项处理，AI 不得代答。
- [ ] 任一 Open Questions 未收敛时整个队列不得进入 running；全部收敛后一次性启动。
- [ ] 其它 planning blocker 由 AI 最多自动修复 3 轮，过程可审计。
- [ ] 显式依赖任务在前置项失败时进入 `blocked-dependency`，独立任务继续；顺序本身不触发失败传播。
- [ ] prepare 能拒绝循环依赖、缺失依赖和自依赖，并输出稳定诊断。
- [ ] 顺序与依赖冲突时执行稳定拓扑重排，无依赖任务保持原相对顺序，running 后队列不可变。
- [ ] staged/冲突/未完成 Git 集成会在启动前全局阻断；无关 unstaged/untracked 改动可作为 protected-retained 保留。
- [ ] auto-loop 不修改或提交 protected-retained 文件；文件冲突只阻塞涉及它的任务。
- [ ] 决策导致 artifact 更新时生成新 hash 并绑定决策事件；无事件的外部漂移仍被阻断。
- [ ] Open Questions 只在全队列 prepare 阶段集中处理；进入 running 后，readiness、context、检查、spec update 或 commit-only 的单项失败不会停止独立后续任务。
- [ ] 多任务全成功时自动推进到本地 commit-only 并进入 completed。
- [ ] auto-loop 不自动归档任务，不移动任务目录，不生成归档 bookkeeping commit。
- [ ] 队列项完成后任务仍保持 `in_progress`；只有后续显式归档才把任务状态改为 `completed`。
- [ ] 部分任务失败时自动处理完其余任务并进入可审计的部分完成终态。
- [ ] 真正的全局安全问题才停止整个 run。
- [ ] 旧 runtime、route、check depth、retry-blocked 和 commit-only 边界保持兼容。
- [ ] 最终 canonical `trellis-auto-loop` SKILL 不超过 `16 KiB` target；如确有必要超过 target，必须保持不超过 `18 KiB` review ceiling、记录增长原因并通过 strict 上下文预算检查。
- [ ] 新增多 planning 队列、批量预检、单次授权、artifact drift、部分失败继续和恢复测试。

## Out Of Scope

- 自动 push、merge、release、deploy 或任务归档。
- 绕过 Git 冲突、生产副作用、外部凭证和数据权限边界。
- 在默认 profile 下允许 AI 任意改写需求并自行批准。
