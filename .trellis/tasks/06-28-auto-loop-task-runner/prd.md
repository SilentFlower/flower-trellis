# Auto loop task runner

## Goal

为 flower-trellis / skill-garden / Trellis 设计并落地一个自动循环跑任务的能力：在不大幅侵入现有 Trellis workflow 的前提下，由额外的 Python runner 跟踪任务队列、步骤推进、压缩恢复、失败重试和安全停点，让 AI 能在用户预授权边界内自动完成当前任务或多个任务。

## Background

- 当前仓库是 `flower-trellis`，负责包装官方 `@mindfoldhq/trellis`，并把 `vendor/skill-garden` 强化包同步为 `enhancements/` 快照。
- 当前 `.trellis/workflow.md` 已有 skill-garden 覆盖层，包含 task brief handoff、route gate、post-check stop gate、commit confirmation gate、push progress recovery 等规则。
- 当前 `.trellis/scripts/` 已有 Python 本地脚本体系，适合作为 auto loop runner 的落点；`.trellis/.runtime/` 已用于会话状态，适合存放自动运行的临时状态。
- 当前 Trellis channel runtime 已提供 worker guard、agent role card 和 durable event log，但任务状态仍应由主会话或额外 runner 控制。
- 上下文会被压缩，自动循环不能依赖聊天记忆；每一步必须写入可恢复的文件状态。
- auto runner 的流程控制必须落在 Python 脚本和磁盘状态里，压缩恢复后由脚本计算下一步，而不是依赖聊天摘要或模型记忆推断流程。

## Confirmed Decisions

- 第一版作为 `flower-trellis` / `skill-garden` 的强化能力落地，不直接修改官方 `@mindfoldhq/trellis` CLI。
- 命令入口、状态目录和状态字段应使用中性、版本化、可迁移的命名，避免绑定到 `skill-garden` 私有实现细节，为未来 upstream 保留空间。
- auto runner 第一版可以在用户预授权范围内把 `planning` 任务自动推进到 `task.py start`，不限定只能接管已 `in_progress` 的任务。
- 自动 `task.py start` 前必须确认任务规划产物已满足 Trellis start gate；如果存在阻塞性 open question、规划产物缺失、dirty worktree 冲突或超出授权范围，必须硬停并等待用户。
- 第一版默认 profile 应是完全自动的 `commit-only`：在本地范围内自动完成 start、implement、check、fix、recheck、必要的 spec update，并在通过质量门禁后自动执行本地 commit；不自动 push。
- auto runner 应接近 `/goal` 理念：用户给定目标和授权边界后，runner 默认持续推进到完成或 commit-only，而不是在常规风险点频繁打断用户。
- 硬停边界应尽量少，只覆盖真正无法继续完成目标、需要用户产品决策、检测到明显越权、或继续执行会产生本次授权外效果的场景。
- 多任务队列中某个任务 blocked 时，runner 默认记录 blocked 原因并跳过该任务，继续执行后续任务，最终汇总完成/blocked 结果。
- 默认每个任务最多 3 轮 fix/recheck；如果连续失败类型相同或无实质进展，可提前判定该任务 blocked。
- 默认每个任务成功后立即执行一次 commit-only；多任务队列不把多个任务混成一个提交。
- auto route 授权不由 profile 直接决定。切换 auto 模式时应写入一个临时 route 授权，优先级低于用户个人 `.trellis/.route-prefs.tmp`，高于交互询问，并通过最小修改 `route_state.py` 兼容现有 `trellis-route` 流程。
- auto 临时 route 授权存放在 `.trellis/.runtime/auto-loop/<run-id>.json`，不写入 `.trellis/.route-prefs.tmp`，避免污染个人偏好；`route_state.py` 在个人偏好 miss 后读取该授权。

## Requirements

- 保留 Trellis 现有 Phase 和用户魔改的 workflow 作为语义步骤来源，不新增一套平行 workflow。
- 增加一个外层 auto runner，用于决定下一步跑什么、记录状态、恢复中断、处理重试和稳定性保护。
- Python runner 是流程控制的权威来源：负责维护任务队列、当前任务、当前 phase/step、尝试次数、blocked 状态、commit-only 进度和下一步动作。
- auto 模式必须由用户显式启动；正常人工模式继续保留原有确认点和 stop gate。
- auto 模式下允许通过 profile / policy 预授权部分卡点，让 AI 在边界内自行决定，例如 route 选择、继续 fix、执行检查、更新 spec。
- auto 模式必须尽量少打断用户；需求冲突、无法归属的 dirty worktree、持续失败无进展、或本次授权外的远端/发布/生产效果才应硬停。
- 支持上下文压缩恢复：runner 每一步都生成短小的 resume capsule，说明当前任务、已完成步骤、下一步、授权范围、变更文件和必须读取的文件。
- 压缩后恢复时，agent 必须优先调用 Python runner 的 resume/next 命令读取状态并获取下一步指令；resume capsule 只作为人类可读摘要，不是权威状态。
- 第一版优先支持当前任务的单任务循环：implement -> check -> fix -> recheck -> commit-only。
- 第一版必须支持一次性指定多个任务，按用户给定顺序逐个跑完；同一 worktree 内不并发跑多个任务。
- 多任务队列中每个任务独立走 `planning -> task.py start -> implement -> check -> fix -> recheck -> commit-only`，一个任务 commit-only 完成后再进入下一个任务。
- 多任务队列遇到 blocked 任务时不阻塞整个队列；runner 记录任务状态、原因、失败摘要和可恢复下一步后继续后续任务。
- runner 不直接写业务代码，不替代 agent 思考；runner 只负责确定性调度、锁、状态、超时、失败分类和恢复。
- 与 skill-garden 的关系应清晰：skill-garden 定义 auto 模式下的规则覆盖、agent 指令和输出协议；Python runner 负责实际状态机。
- auto 模式允许覆盖 `planning -> task.py start -> implement -> check -> fix -> recheck -> commit-only`，但每个阶段仍复用 Trellis 现有 gate 和任务产物规则。
- 默认 auto profile 应跑到本地 commit 为止，而不是停在 commit plan；commit 必须使用 Trellis commit-only 语义自动归属文件并生成提交信息，不执行 push。
- commit-only 前 runner 必须尽量自动判断任务相关文件；无法安全归属的文件不应被提交，并应在任务备注/结果摘要里记录未提交原因和人工处理提示。
- 安全、凭证、发布、归档、外部系统等词本身不应自动触发停顿；只有当实际操作会越过本地 commit-only 边界、需要真实密钥/外部权限、或无法安全模拟/验证时才停。

## Acceptance Criteria

- [ ] 形成明确的技术设计，说明 auto runner、现有 workflow、skill-garden override、channel worker、task runtime 的边界。
- [ ] 形成最小 MVP 范围，包含命令入口、状态文件结构、恢复策略、失败分类和安全停点。
- [ ] 形成 Python runner 的流程控制接口设计，说明 start/next/record/resume/stop 等命令如何驱动 auto loop。
- [ ] 形成 auto policy/profile 设计，区分可自动决定、可预授权决定、必须停住三类操作。
- [ ] 形成上下文压缩恢复设计，包含 resume capsule 的字段和读取规则。
- [ ] 形成单任务循环的状态机设计，覆盖 implement/check/fix/recheck/commit-only。
- [ ] 形成多任务顺序队列设计，说明显式任务列表、任务顺序、锁、跳过、blocked、恢复和继续运行规则。
- [ ] 明确第一版允许自动 commit-only，但不自动 push，不自动发布/归档，不默认并发修改同一 worktree。
- [ ] 明确 auto route 临时授权与 `.trellis/.route-prefs.tmp` / session runtime route state 的优先级和兼容策略。
- [ ] 明确 auto runtime state 路径为 `.trellis/.runtime/auto-loop/<run-id>.json`，并纳入压缩恢复、route 授权和清理策略。
- [ ] 明确落地文件位置和同步策略，避免只改当前项目而忘记 skill-garden 源、enhancements 快照或已安装副本。
- [ ] 规划完成后补齐 `design.md` 和 `implement.md`，经用户确认后再进入实现。

## Out Of Scope For MVP

- 自动 push、发布或归档。
- 多任务同一 worktree 并发修改。
- 自动把模糊需求创建成可执行任务并直接开跑。
- 绕过 Trellis 原有 task artifacts、spec 注入和质量检查。
- 修改官方 `@mindfoldhq/trellis` 全局安装目录或 `node_modules`。

## Resolved Boundaries

- 授权边界：默认 `commit-only` profile 应持续推进，常规工程风险不作为用户审批点。
- 任务生命周期边界：auto 可在预授权范围内从 planning 调用 `task.py start`；start gate 缺口会导致当前任务 blocked，并继续队列后续任务。
- 队列边界：用户可一次性显式指定多个任务，runner 按给定顺序执行；blocked 任务记录原因后跳过，不阻塞整个队列。
- 并发与锁边界：同一 worktree 内不并发跑多个任务；多任务并发需要后续版本引入独立 worktree 或等价隔离。
- Dirty worktree 边界：commit-only 前尽量自动归属任务相关文件；无法归属的 dirty 文件不提交，并记录备注或 blocked 摘要。
- 失败分类边界：runner 记录工具失败、网络/超时、测试失败、需求冲突、spec 漂移、route 决策缺失、subagent 挂起和重复修复无进展。
- 重试与停止边界：默认每个任务最多 3 轮 fix/recheck；同类失败重复且无进展可提前 blocked。
- 压缩恢复边界：Python runner 状态是权威来源；resume capsule 只作为人类可读摘要。
- Agent 职责边界：runner 做确定性调度和状态持久化，agent 做实现、检查、修复和解释。
- Route 边界：auto 模式通过 `.trellis/.runtime/auto-loop/<run-id>.json` 里的临时 route 授权减少询问；优先级为 session runtime route state -> `.trellis/.route-prefs.tmp` 个人偏好 -> auto 临时授权 -> 交互询问。实现上尽量只扩展 `route_state.py` 的解析来源和优先级，不重写 `trellis-route` 流程。
- Check 边界：auto 默认走 check-all；轻量 check 仅作为显式逃生口或后续扩展。
- Spec update 边界：默认允许自动更新与本任务直接相关、可由代码/测试证据支撑的 `.trellis/spec/`；只有产品策略或长期规范不确定时才停。
- Commit / push 边界：MVP 允许自动 commit-only，但禁止 push、发布和归档。
- 同步源边界：涉及 skill-garden 0.6 强化包时，先改 `vendor/skill-garden` 源，再同步 `enhancements/`，必要时同步当前 dogfood 副本。
- 最小停顿边界：只有真正 blocked、越权或需要用户产品决策时才打断用户。
