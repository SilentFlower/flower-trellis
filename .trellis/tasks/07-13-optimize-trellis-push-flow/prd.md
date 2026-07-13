# 优化 Trellis 提交与推送流程

## Goal

统一普通 `check-all`、`trellis-push` 与 `trellis-auto-loop` 的提交边界：Phase 3.3 保持现有触发与审查语义，进入 Phase 3.4 时必须使用默认 push 的 `trellis-push`，不得由 AI 自制提交计划；auto-loop 保持仅 commit-only；同时压缩大型、多仓库和无任务场景的计划输出，且不降低精确暂存与用户确认安全性。

## Background

- 用户观察到：普通 `check-all` 通过后，AI 没有进入 `trellis-push`，却自行输出 `Proposed commits`、草拟 commit message，并要求回复 `ok` 执行本地提交；输出还擅自声明“不会推送”。
- 普通 `trellis-push` 的现有默认语义本来是处理有变更仓库并 push；`commit-only` 只应在用户明确要求时使用。证据：`.agents/skills/trellis-push/SKILL.md:59-67`。
- `trellis-auto-loop` 当前只有 `commit-only` profile，本任务确认保持该边界，不增加远端 push 授权。证据：`.trellis/scripts/auto_loop.py:17`、`.trellis/scripts/auto_loop.py:1261`。
- 当前 workflow 要求业务代码提交/推送只能走 Phase 3.4 `trellis-push`，普通 `check-all` 后先停止并报告；本任务保留该 Phase 3.3 时机，只修复后续进入 Phase 3.4 时绕过 `trellis-push` 的问题。证据：`.trellis/workflow.md:228-246`。
- 实现阶段确认直接根因：上游 workflow 下层 Phase 3.4 仍包含 `Proposed commits`、本地直接 commit 和 `Never push` walkthrough；高优先级 hub 虽然要求走 `trellis-push`，但未明确宣告下层整段失效，模型可能混用两套流程。证据：`.trellis/workflow.md:780-820`。
- 当前确认门禁要求展示精确文件列表和草拟 commit message；文件较多时容易产生冗长输出。证据：`.trellis/workflow.md:238`。
- 历史任务 `06-29-auto-loop-commit-route-fixes` 已确认：auto-loop 的本地 commit 也必须经过 `trellis-push` 的计划、文件归属、精确暂存和 runner 回写边界，不能由主 agent 临时拼装 `git add` / `git commit`。
- skill-garden 0.6 强化行为的源头是 `vendor/skill-garden/.trellis/0.6/`；随后运行 `npm run sync` 更新 `enhancements/0.6/`，并同步当前 dogfood `.agents` / `.claude` 副本。

## Requirements

### R1. `trellis-push` 是唯一提交与推送入口

- 普通流程、auto-loop 和 finish-work 前置流程中的业务代码 commit/push 都必须进入 `trellis-push` 语义。
- `check-all`、主 agent、implement/check agent 不得自行生成替代性的“提交计划 + 回复 ok 执行”流程。
- AI 只能在 `trellis-push` 内草拟最终 commit message，不得把草案生成能力当成绕过 `trellis-push` 的理由。
- 普通模式下，用户确认前禁止 `git add`、commit、push；auto-loop 只能在既有 commit-only 预授权范围内跳过二次确认。

### R2. Phase 3.3 保持现有时机

- 普通 `check-all` 最终通过后继续遵循现有 post-check stop gate，不因本任务立即自动执行 Phase 3.3。
- post-check 报告包含各检查维度结论、已执行验证、剩余风险、总体结论和下一步提示，然后等待用户继续；不得包含 commit message、拟提交文件、`Proposed commits` 或“回复 ok 提交”。
- Phase 3.3 仍是提交前 required-once 审查：当现有流程进入该阶段时，判断是否有可复用契约、约定、坑点或设计决策；无必要时 no-op，有必要时更新 `.trellis/spec/`。
- Phase 3.3 完成并进入 Phase 3.4 后，必须生成真正的 `trellis-push` 计划，不得由主 agent 生成替代性提交计划。
- `trellis-push` 计划显示最近一次 Phase 3.3 结论：`无需更新` 或具体已更新文件；无活动任务时显示跳过。
- 只有 `trellis-push` 计划确认后才执行 Git 写操作。

### R3. 普通 push 与 auto-loop commit-only 严格分离

- 普通 `trellis-push` 默认执行 commit + push 当前分支；只有用户明确说“只提交不推”或显式选择时才使用 commit-only。
- `trellis-auto-loop` 保持唯一 `profile=commit-only`：自动推进到任务相关本地 commit，不 push、不 merge、不 release、不 archive。
- 用户启动 auto-loop 只预授权当前 run 内任务相关本地 commit，不构成远端 push 授权。
- auto-loop 保留现有 `run_spec_update -> commit_only` 顺序、profile 和 action schema；`commit_only` 继续进入 `trellis-push` auto-loop 预授权路径。

### R4. 紧凑而可复核的计划排版

- 计划顶部显示 mode、仓库数、commit 数、文件数、风险数和执行顺序，第一屏即可判断操作性质。
- 每个仓库使用扁平区块，按 commit message、branch/upstream、diff stat、文件摘要和 push mode 的顺序展示。
- 每仓库 planned files 不超过 8 个时完整展示；超过 8 个时按目录归组，文件区最多 12 行，并提供 `展开文件` 查看同一份精确列表。
- Spec review、验证结果和 snapshot 默认各显示一行；失败、部分完成或需要用户决策时才展开详情。
- 空分组省略，不重复输出多行“无”；风险为零时只在顶部摘要显示一次。
- 未识别 dirty、已 staged、冲突、跨任务文件和其他高风险文件必须独立逐项展示，不受 8 文件/12 行限制。
- 内部始终维护 exact planned files 和 retained files；执行仍只允许精确 `git add <files>`，禁止 `git add -A` / `git add .`。
- 执行前 planned files 或 Git 状态发生变化时，原计划失效，普通模式必须重新确认。

### R5. 多仓库与无活动任务场景

- 多仓库计划逐仓独立生成 commit message、文件范围、branch/upstream 和 push 结果；普通模式对完整计划只确认一次。
- 任务级 Spec review、snapshot 和父仓 bookkeeping 放在所有业务仓库之后，不归入任何单一业务仓库。
- 无活动任务时仍允许普通 `trellis-push` 处理可安全归属的变更，但顶部必须明确显示“无活动任务”。
- 无活动任务时显示 `Spec review：跳过`、`Snapshot：跳过`、`Bookkeeping：跳过`，不得构造虚假任务进度。
- 无活动任务且当前会话无法证明 dirty 文件来源时，所有来源不明文件默认列为未识别 dirty 并排除；只有用户明确指定范围后才能纳入，并重新生成计划。

### R6. Commit message 与结果展示

- commit message 输入优先级为：用户明确提供 > 任务材料与实际 diff > 最近提交风格。
- 普通模式把 message 与 mode、文件范围和 push 目标放在同一次确认中；用户修改后重新展示计划。
- auto-loop 可在既有 commit-only 预授权内自动采用草拟 message，结果必须报告实际 message 和 commit hash。
- 执行结果复用计划的视觉顺序：总览、逐仓 commit/push、snapshot/bookkeeping、保留未提交文件。

### R7. 强化源、workflow 与副本一致

- 更新 workflow 高优先级门禁，明确“生成 commit message 草案”不等于进入了 `trellis-push`。
- hub 和 in-progress state guard 必须明确整段覆盖下层 Phase 3.4 的 `Proposed commits` / local-only / no-push walkthrough；保留上游正文但在强化模式下视为 inactive。
- 更新 `trellis-push`、`trellis-auto-loop` 及必要的 finish-work 文案，清楚区分普通默认 push 与 auto-loop 固定 commit-only。
- 先修改 `vendor/skill-garden/.trellis/0.6/` 源，再运行 `npm run sync`；同步 `enhancements/0.6` 和当前 `.agents` / `.claude` dogfood 副本。
- 项目 spec 记录新的 post-check transition、排版、无任务归属和普通/auto-loop 模式边界。

## Acceptance Criteria

- [ ] 普通 `check-all` 通过后保持现有 post-check stop gate 和 Phase 3.3 时机；进入 Phase 3.4 时不再出现自制提交确认旁路。
- [ ] hub/state guard 明确整段禁用下层 Phase 3.4 `Proposed commits` / local-only / no-push walkthrough，避免两套流程混用。
- [ ] post-check 报告只包含质量结论、验证结果、剩余风险和下一步提示，并等待用户继续，不包含任何提交计划内容。
- [ ] 计划始终显示 Spec review 的 no-op 或已更新文件结论。
- [ ] 普通 `trellis-push` 默认 commit + push；只有显式请求时才使用 commit-only。
- [ ] auto-loop 继续只支持 commit-only，原有 profile/action/runtime schema 不变，且不会执行远端 push。
- [ ] 每仓库 8 个文件以内完整展示；超过 8 个按目录归组且文件区最多 12 行，`展开文件` 可查看精确列表。
- [ ] 风险文件始终逐项完整展示，紧凑排版不改变精确暂存与计划漂移重确认规则。
- [ ] 多仓库逐仓独立展示并只做一次统一确认，任务级信息位于所有业务仓库之后。
- [ ] 无活动任务时明确跳过 spec review、snapshot 和 bookkeeping；无法证明来源的 dirty 文件默认排除。
- [ ] commit message 只能由 `trellis-push` 最终草拟/采用，普通模式纳入一次确认，auto-loop 结果报告实际 message/hash。
- [ ] `vendor/skill-garden` 源、`enhancements/0.6`、当前 `.agents` / `.claude` 副本通过一致性检查。
- [ ] `npm run sync`、`git diff --check`、workflow/skill 文案扫描和普通/auto-loop 场景验证通过。

## Out of Scope

- 为 auto-loop 新增 push profile 或任何远端 push 预授权。
- 自动 merge、force push、release、部署或生产数据操作。
- 自动解决 push rejection、merge/rebase 冲突或凭证问题。
- 把 `trellis-push` 完整改造成独立 Git 客户端。
- 取消文件归属检查、精确暂存或普通模式的用户确认权。
- 改动官方 `@mindfoldhq/trellis` npm 包源码。
