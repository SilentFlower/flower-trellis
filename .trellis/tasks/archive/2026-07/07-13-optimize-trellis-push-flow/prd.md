# 简化 Trellis 提交、进度与收尾流程

## Goal

把 `trellis-push` 收缩回“任务相关 commit/push”的核心作用，同时保留每次普通 push 后立即同步到远端的任务进度；将 merge、auto-loop 状态协议、release 推断和 finish-work 判断拆回各自职责，避免多个 skill 通过 `push_mode`、snapshot 草案和 bookkeeping 细节互相耦合。

## Background

- 用户最初观察到：普通 `check-all` 通过后，AI 没有进入 `trellis-push`，却自行输出 `Proposed commits`、草拟 commit message，并要求回复 `ok` 执行本地提交；输出还擅自声明“不会推送”。
- 普通 `trellis-push` 的默认语义本来是处理有变更仓库并 push；`commit-only` 只应在用户明确要求时使用。原始证据：`.agents/skills/trellis-push/SKILL.md:59-67`。
- `trellis-auto-loop` 当前只有 `commit-only` profile，本任务保持该边界，不增加远端 push 授权。原始证据：`.trellis/scripts/auto_loop.py:17`、`.trellis/scripts/auto_loop.py:1261`。
- workflow 要求业务代码提交/推送只能走 Phase 3.4 `trellis-push`，普通 `check-all` 后先停止并报告。原始证据：`.trellis/workflow.md:228-246`。
- 上游 workflow 下层 Phase 3.4 仍包含 `Proposed commits`、本地直接 commit 和 `Never push` walkthrough；高优先级 hub 未明确整段禁用时，模型会混用两套流程。原始证据：`.trellis/workflow.md:780-820`。
- 原确认门禁要求展示精确文件列表和 commit message；文件较多时输出冗长。原始证据：`.trellis/workflow.md:238`。
- 当前 `trellis-push` 已增长到 500 行以上，同时承担 commit、push、merge、snapshot、父仓 bookkeeping、多仓库、无任务场景和 auto-loop runtime 协议，超出单一 skill 的合理职责。
- finish-work 也通过 `last_push_snapshot.push_mode` 与 `trellis-push` 反向联动，并内置完整 release 推断，导致归档、journal、release 和 Git push 相互缠绕。
- `task.py archive` 当前会把整个 archive 根目录交给 `git add`；旧归档和其他任务文件可能被带入。精确 `git add -- <paths>` 与 `git commit --only -- <paths>` 已验证可以隔离当前任务，并保留计划外 untracked/unstaged/staged 文件。
- skill-garden 0.6 的源位于 `vendor/skill-garden/.trellis/0.6/`；修改后运行 `npm run sync` 更新 `enhancements/0.6/`，再同步当前 `.agents` / `.claude` dogfood 副本。

## Requirements

### R1. 保持 workflow 门禁，删除提交旁路

- 普通 `check-all` 通过后继续执行 post-check stop：只报告质量结论、验证结果、剩余风险和下一步，然后等待用户继续。
- Phase 3.3 `trellis-update-spec` 的 existing required-once 语义不变；它自己负责 Spec review，`trellis-push` 不重复展示其结论。
- Phase 3.4 必须进入真正的 `trellis-push`；check skill、主 agent 和其他 agent 不得自行生成 `Proposed commits`、commit-only 决策或替代确认流程。
- workflow hub 与 in-progress state guard 必须明确整段禁用下层 Phase 3.4 的 local-only / no-push walkthrough。
- workflow hub 只声明 Phase 3.4 所有权、exact scope + message、一次确认和 Git 安全边界；计划/结果的详细格式完全由 `trellis-push` 管，hub 不重复模板、字段顺序、仓库命名、retained 标签或展示阈值。

### R2. `trellis-push` 只负责精确 commit/push

- 普通模式默认 commit + push；只有用户明确要求时才使用 commit-only。
- 普通确认界面沿用原有可扫描样式：`[PUSH / COMMIT-ONLY] 仓库数 · commit 数 · 文件数 · 保留未提交数 · 风险数`，再按仓库展示 commit message、branch/upstream、变更统计和 exact planned files；任务进度只显示 completed/partial/next 单行摘要。
- `retained` 是内部术语，专指当前存在但本次明确不提交、保持原状的 dirty paths，包含计划外 untracked、unstaged 和 staged。用户可见标题统一写“保留未提交的变更（dirty）”，并标注 Git 状态；clean files 不进入 retained。
- 真正需要用户处理的 unknown ahead、branch/upstream 异常或文件归属风险单独放入“风险”，不得把普通 retained dirty 默认描述成阻塞。
- 分仓标题必须显示真实仓库名：优先 package 名，否则使用 Git top-level 目录名；`root`、`parent`、`main repo` 仅作为输入别名，不得出现在用户输出中。
- 整个多仓库计划只确认一次。每仓 planned files 不超过 8 个时完整展示；超过 8 个时按目录归组并支持展开同一份 exact files；保留 dirty 和风险条目始终逐项展示。
- 执行使用 `git add -- <exact files>` 和 `git commit --only -m <message> -- <exact files>`。计划外 untracked、unstaged、staged 文件保持原状，不阻塞当前任务提交。
- planned files、branch、upstream、冲突状态或 push 目标发生变化时重新确认；只有 retained files 变化时更新摘要并继续。
- commit message 优先级为：用户明确提供 > 任务材料与实际 diff > 最近提交风格。
- 保留多仓库处理，因为业务变更可能位于子仓，任务进度位于父仓；每个仓库只重复相同的 exact commit/push 流程。
- 无活动任务时，只允许当前会话能够明确归属的文件进入计划；无法证明来源的 dirty 文件默认 retained。无任务时不生成任务进度。
- `trellis-push` 不再展示 Spec review、检查验证、snapshot JSON、bookkeeping 实现细节、安全规则长文或 finish-work 状态。
- 执行结果复用原有视觉顺序：总览 → 逐仓 commit/push → 任务进度 → 保留未提交的变更（dirty）；业务结果和 progress sync 结果分开显示。
- merge 完全移出 `trellis-push`：不读取/回写 `merge_target`，不支持 reconfigure、临时目标、push 后 merge、主分支警告或 merge 冲突编排。merge 由独立能力或人工 Git 操作负责。

### R3. 每次普通 push 后立即同步最小任务进度

- 任务进度必须支持本地跨会话恢复，并在每次普通 push 后立即同步到远端；等待下一次自然提交不满足要求。
- 当前任务 `task.json` 使用独立 `progress` 对象，字段固定为 `updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes`。
- 不再写入 `push_mode`，不回填业务 commit hash，不生成可编辑 snapshot 草案，也不让 finish-work 读取进度决定 Git 行为。
- 普通 push 计划首次确认时只展示一行进度摘要。业务 push 完成后，使用固定 message 对 exact `task.json` 生成独立进度 commit，并立即 push 到任务父仓；不进行第二次确认。
- 多仓库全部成功时记录完整进度；只要发生过成功的业务 commit/push，即使后续仓库失败，也必须同步已完成仓库、失败步骤、下一恢复动作和失败原因。
- 尚未发生成功 Git 动作就失败时，不记录虚假 completed steps；允许记录 partial/next/failure notes，前提是任务父仓仍可安全提交和 push。
- 进度 commit/push 失败时不回滚已成功的业务 commit/push；结果必须分别报告业务执行状态和进度同步状态。
- 新的 task progress helper 读取 `progress`；对已有任务兼容读取 `last_push_snapshot` 并映射为新字段，下一次成功写入时迁移到 `progress`。新写入不再产生 `last_push_snapshot`。
- 恢复提示从“push snapshot recovery”改为“task progress recovery”，只展示 partial/next/notes，不恢复旧 push 编排状态。

### R4. Auto-loop 管状态，`trellis-push` 只执行内部 commit-only

- auto-loop 保留唯一 `profile=commit-only`、现有 `commit_only` action 和 runtime schema，不 push、不 merge、不 release、不 archive。
- `trellis-auto-loop` 负责校验 profile、current task、outstanding action 和预授权，并基于 task artifacts 与 Git diff 生成 exact files 和 commit message。
- `trellis-push` 的内部 commit-only 模式只接收已经确定的 exact files 与 message，执行精确 commit；不读取 auto-loop runtime，不判断 queue/blocked/skipped，也不直接调用 runner `record`。
- commit 成功后由 `trellis-auto-loop` 把 commit hash、files 和 message 回写 `auto_loop.py record`；失败或文件归属不安全时也由 `trellis-auto-loop` 记录 blocked/failed 并决定是否继续队列。
- auto-loop 不触发普通 push 后的远端任务进度 commit；runner 自身保存本地循环状态，后续普通 push 再同步远端任务进度。

### R5. Finish-work 只编排 release audit、archive 和 journal

- finish-work 开始时记录 current branch、upstream 和 `@{u}..HEAD` 基线；不读取 `progress`、`last_push_snapshot.push_mode` 或 trellis-push runtime。
- finish-work 在 archive 前自动调用 `trellis-release audit-current`，然后使用 `task.py archive --no-commit` 和 `add_session.py --no-commit` 落盘。
- archive commit 只允许归档前源路径、命令返回的 `.trellis/tasks/archive/YYYY-MM/<task>` 目标路径，以及实际被修改的 child `task.json`。
- journal commit 只允许本次实际修改的 journal/index 文件。禁止暂存 `.trellis/tasks/archive`、`.trellis/tasks`、`.trellis/workspace` 或 `.trellis` 根目录。
- archive/journal 均使用 exact add + `git commit --only`。其他任务、旧归档和计划外 untracked/unstaged/staged 文件保持原状，不阻塞。
- finish-work 开始时 `HEAD == upstream`：完成 bookkeeping commits 后自动 push；开始时分支已 ahead：完成本地 commits 但不自动 push；无 upstream 时仅保留本地 commits。
- `session_auto_commit=false` 时只落盘并报告 exact dirty paths，不生成 bookkeeping commits，也不自动 push。

### R6. `trellis-release audit-current` 承担单任务上线核对

- `trellis-release` 新增内部 `audit-current` 模式，只核对当前活动任务，不生成 `.trellis/releases/` 批次上线单，不执行上线操作，也不要求额外确认。
- `audit-current` 读取当前任务 artifacts、现有 `release.md` 和 Git 证据：高置信存在上线事项时创建或更新 `<task>/release.md`；高置信无事项时 no-op；证据不确定时写入 `Needs human review`。
- finish-work 只调用该模式并读取结构化结论，不再复制 SQL、配置、批处理、外部系统和漂移推断规则。
- 用户显式运行普通 `trellis-release` 时，保留现有多任务范围、批次上线单草案和写盘确认流程。

### R7. 源、快照、workflow 和平台副本一致

- 先修改 `vendor/skill-garden/.trellis/0.6/` 中的 skill、workflow override、workflow-state 和进度 helper 源，再运行 `npm run sync`。
- 同步更新 `enhancements/0.6`、当前 `.agents` / `.claude`、`.trellis/workflow.md` 和项目 spec。
- AI-facing control protocol（尤其 `overrides/workflow.md` 与 `workflow-states/*.md`）保持既有源语言；当前英文协议正文不得因项目中文文档规范被整段翻译。用户实际输入的字面命令、任务文档和代码注释仍按各自既有约定处理。
- 删除或替换旧 `push_snapshot.py` 分发项时，manifest 与升级清理必须移除由 flower 铺设的旧脚本，不删除用户自有文件。
- 不修改官方 `@mindfoldhq/trellis` npm 包源码。

## Acceptance Criteria

- [ ] post-check 只报告检查结果并停止；Phase 3.4 只能进入 `trellis-push`，不存在自制提交旁路。
- [ ] 普通 `trellis-push` 计划与结果沿用原有总览/分仓样式，但内容只保留精简后的 commit/push/progress；计划只确认一次。
- [ ] 用户可见输出把 retained 明确显示为“保留未提交的变更（dirty）”，区分 untracked/unstaged/staged，并与真正风险分区。
- [ ] 普通模式默认 commit + push；显式请求时才 commit-only；merge 相关入口和配置全部退出 `trellis-push`。
- [ ] exact `git commit --only` 不消费其他任务的 untracked/unstaged/staged 文件；retained-only 变化不触发重新确认。
- [ ] 多仓库完整成功和部分成功/失败都能生成正确的最小 `progress`，并立即通过独立进度 commit/push 同步到远端。
- [ ] 新进度不包含 `push_mode`、业务 commit hash 或 snapshot 草案；旧 `last_push_snapshot` 可读取并在下一次写入时迁移。
- [ ] auto-loop 仍只本地 commit；runner 校验/回写不再出现在 `trellis-push`，内部 commit-only 仍复用精确提交能力。
- [ ] finish-work 自动调用 `trellis-release audit-current`，精确提交 archive/journal，并仅依据开始时的 Git 基线决定是否自动 push。
- [ ] 普通 `trellis-release` 的批次上线单与确认流程保持不变。
- [ ] workflow hub/state 的协议正文保持既有英文，不能出现整段中文翻译；新增行为只做语义级修改。
- [ ] workflow hub 不复制 `trellis-push` 的展示模板，只明确详细格式由该 skill 管理并保留必要门禁。
- [ ] vendor、`enhancements/0.6`、当前平台副本和 workflow 语义一致；`npm run sync`、语法检查、`git diff --check`、幂等验证和场景验证通过。

## Out of Scope

- 为 auto-loop 新增远端 push profile 或远端授权。
- 在 `trellis-push` 中执行 merge、release、部署或生产数据操作。
- 自动解决 push rejection、merge/rebase 冲突或凭证问题。
- 将 `trellis-push` 改造成通用 Git 客户端。
- 取消文件归属检查、精确暂存或普通模式的一次确认权。
- 修改官方 `@mindfoldhq/trellis` npm 包源码。
