# Auto loop commit and route state fixes

## Goal

修复 `trellis-auto-loop` 在 commit-only、route 决策、完成态提示和 stale runtime 指针上的设计缺陷，使自动任务循环继续保持“显式启动、自动推进到本地提交、不自动归档”的边界，同时不绕过 `trellis-route` 和 `trellis-push` 的统一安全语义。

## Background

- 本轮复盘发现 auto-loop `commit_only` action 虽然要求“使用 `trellis-push` commit-only auto-loop 预授权路径”，但主会话实际可以按规则自行复核后直接执行 `git commit`。结果可能正确，但绕过了 `trellis-push` 统一计划、隔离和回写边界。
- auto-loop runtime 中 `queue.item.status=completed` 和 summary 的 `completed` 容易被理解为“任务已完成/已归档”。实际语义只是“该 auto-loop item 已提交完毕”；任务 `task.json.status` 仍保持 `in_progress`，直到用户显式运行 finish-work/archive。
- 初版 auto-loop 启动默认写入 `route_authorization: { implement: "subagent", check: "check-all-subagent" }`。这不符合用户预期：route 应先复用用户已有选择/偏好；否则必须走 `trellis-route` 的正常询问或 fallback，而不是 auto-loop 预设 subagent 并让它看起来像真实执行结果。
- `.trellis/.runtime/auto-loop/current.json` 在 run completed/stopped 后仍指向旧 run。`auto_loop.py start` 目前不会被 completed run 卡住，但 `route_state.py` 会优先读取该 stale pointer 并返回 `auto-run-not-running`，诊断不清晰，也会影响 fallback 到唯一 running run 的路径。
- 多任务队列不能在每个任务 commit-only 后卡住等待 finish-work；finish-work/archive 必须仍是用户显式动作。可以在最终汇总中提示“这些任务已本地提交但未归档”，但不能阻断继续跑后续任务。
- 现有 auto-loop runtime 只能看到 action 流和 commit hash，看不到模型在关键节点做出的可审计决策，例如 route 最终选了 inline 还是 subagent、commit-only 为什么认为文件范围安全、是否写入 snapshot、哪些任务仍未归档。
- auto-loop 的多任务队列有特殊性：单个任务因为 Git 状态污染或提交预检不安全而不能 commit-only 时，不应停止整个 run，后续任务仍应继续尝试推进。

## Requirements

### R1. Auto-loop 完成态输出语义更清楚

- 保留 runner 内部状态机可兼容的基础上，输出层避免把 auto-loop item 的 `completed` 误读成任务生命周期完成。
- `status` / `next` / `resume_capsule` 的摘要应表达“auto-loop 已提交完毕，任务仍可能是 `in_progress`，归档需 finish-work”。
- 多任务队列最终 done 时应汇总已提交但未归档的任务；单个任务 done 时也应给非阻塞提示。
- 不得在单个 task commit-only 后卡住等待 finish-work；多任务队列必须继续处理下一个任务。
- 单个任务因为 Git 状态不安全无法 commit-only 时，只能影响该任务；runner 应记录该任务 failed/blocked/skipped，并继续后续任务。

### R2. Auto-loop commit-only 必须走 `trellis-push` 边界

- `commit_only` action 的说明、skill 文档和执行路径必须明确：由 `trellis-push` auto-loop commit-only 语义处理提交计划、文件归属、未识别 dirty 隔离、commit-only 不 push/merge/archive 和 runner commit hash 回写。
- 需求不是“永远不能执行 git commit”，而是 auto-loop 的提交不得由主 agent 临时拼装提交流程绕过 `trellis-push` 的统一边界。
- 文件归属判断不由 Python 脚本基于 dirty baseline 或时间差猜测；由 AI 基于任务 artifacts、`git status`、`git diff` 和必要文件内容生成提交计划，`trellis-push` 负责边界复核、精确暂存、commit 和 runner 回写。
- commit-only 的安全判断交给 `trellis-push` 边界：它必须输出提交计划并做预检；如果当前 Git 状态可能混入非本任务改动或无法安全隔离，则当前任务暂停/blocked 并说明原因，但多任务 auto-loop run 继续处理后续任务。

### R3. Route 准备度由 trellis-auto-loop skill 启动时判断，runtime 记录真实选择

- auto-loop 启动不应默认写 `route_authorization` 为 subagent/check-all-subagent。
- `trellis-auto-loop` skill 在调用 `auto_loop.py start` 前负责判断当前任务是否已经具备可自动推进的 route 条件：
  - 若已有当前任务 target-matched runtime route 决策，可以启动并复用真实决策。
  - 若用户有 `.trellis/.route-prefs.tmp`，可以启动并由 `trellis-route` 写回真实决策。
  - 若缺少 route 决策/偏好，skill 应先进入 `trellis-route` 的正常询问 / fallback，拿到真实决策后再启动或继续 auto-loop。
- Phase 2.1 / 2.2 仍必须通过 `trellis-route`：
  - 若已有当前任务 target-matched runtime route 决策，复用真实决策。
  - 若用户有 `.trellis/.route-prefs.tmp`，按个人偏好命中并写回 runtime。
  - 若没有偏好或 runtime 决策，进入 `trellis-route` 的正常询问 / fallback，而不是由 auto-loop 默认替用户选择。
- auto-loop runtime 应记录真实 resolved route，例如 `route_decisions` 或 item-level route summary，而不是把“临时授权默认值”展示成真实执行结果。
- planning start gate 仍需判断 JSONL 是否必需，但判断依据应来自 skill 启动前已解析出的真实 route 偏好/决策；不能由 `auto_loop.py` 默认假设 subagent 或 inline。

### R4. Stale `current.json` 双向修复

- `auto_loop.py` 在 run completed 或 stopped 后应清理或失效 `.trellis/.runtime/auto-loop/current.json`，避免旧 run 长期显示为 current。
- `route_state.py` 读取 auto-loop pointer 时应容错：如果 pointer 指向不存在或非 running run，应忽略 stale pointer，并 fallback 到“唯一 running run”扫描。
- 对 session runtime 里的 `current_auto_run` 也要按 running 状态校验；旧 completed run 不得阻止发现唯一 running run。

### R5. 文档、workflow 和发布快照保持一致

- 修改源头应优先在 `vendor/skill-garden/.trellis/0.6`，再运行 `npm run sync` 同步到 `enhancements/0.6`，必要时同步当前 dogfood 副本。
- 更新 `trellis-auto-loop` / `trellis-route` / `trellis-push` 相关说明，避免旧文案继续宣称 auto-loop 默认 subagent 授权。
- 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 中 Auto Loop Runner / route helper 约定，记录本次修复后的契约。

### R6. Auto-loop runtime 记录关键决策摘要

- auto-loop runtime 应记录关键决策摘要，便于恢复、复盘和排查，而不是只记录 action 名和最终 commit hash。
- 记录内容应是可审计的结论和证据摘要，不记录完整模型思维链或长篇对话。
- 至少覆盖：
  - route 决策：target、真实 mode、来源（runtime / prefs / user fallback / subagent dispatch result）、task。
  - commit-only 决策：计划提交文件、保留未提交文件、commit message、是否写 snapshot、work commit / snapshot commit。
  - 完成态决策：auto-loop item 已提交但任务是否仍 `in_progress`、是否需要用户显式 finish-work。
  - 失败/blocked 决策：失败类型、涉及文件、下一步建议。
- 决策日志必须跟随 queue item 或 run state 存在于 `.trellis/.runtime/auto-loop/<run-id>.json` 中，压缩恢复后 `status` / `resume` 能展示简短摘要。
- 决策日志不能成为新阻塞点：记录失败时应给出 warning 或最小记录，但不得在已安全完成的动作后误标失败。

## Acceptance Criteria

- [ ] auto-loop 新 run 默认不再写入 subagent/check-all-subagent 形式的 `route_authorization`，除非用户显式选择/配置了临时 route 策略。
- [ ] 在无 runtime route 决策、无个人偏好的情况下，`trellis-auto-loop` skill 启动前会先通过 `trellis-route` 正常产生真实决策；runner 不静默默认 inline 或 subagent。
- [ ] 有个人 `.trellis/.route-prefs.tmp` 时，auto-loop 路由复用与普通 `trellis-route` 一致，并把真实 resolved mode 写入 runtime。
- [ ] `commit_only` action 通过 `trellis-push` 统一边界执行；验证中不得出现主 agent 脱离 `trellis-push` 语义随意 `git add .` / `git commit` 的路径。
- [ ] commit-only 预检能识别可能混入非本任务改动的 Git 状态；不安全时暂停并说明原因，安全时继续执行计划。
- [ ] 单个任务 commit-only 预检失败时，runner 记录该任务 failed/blocked/skipped，并继续队列后续任务；不得因一个任务的 Git 污染停止整个 auto-loop run。
- [ ] 多任务队列中第一个任务 commit-only 后继续下一个任务，不等待 finish-work；最终 done 汇总未归档任务。
- [ ] run completed/stopped 后 `current.json` 被清理或标记失效；`route_state.py` 遇到 stale pointer 会忽略并扫描唯一 running run。
- [ ] auto-loop runtime 能展示关键决策摘要，包括真实 route mode、commit-only 文件计划、snapshot/work commit、未归档任务提示和失败摘要。
- [ ] 决策日志不包含完整模型思维链，只包含结论、证据来源和可复核字段。
- [ ] `python3 -m py_compile` 覆盖 auto-loop 和 route helper。
- [ ] 源、`enhancements/0.6`、当前 dogfood 副本保持一致；`npm run sync` 后无意外漂移。

## Out of Scope

- 不让 auto-loop 自动执行 finish-work、archive、push、merge、release。
- 不改变 `trellis-route` 的用户交互选项语义。
- 不引入长期守护进程、外部数据库或网络服务。
- 不重构整个 `trellis-push` 为完整 CLI；只明确 auto-loop commit-only 必需的计划与边界规则。

## Open Questions

- 无阻塞性 open question。已确认不新增 `push_commit_only.py`；commit-only 文件归属交给 AI 语义判断，`trellis-push` 只承担计划复核与执行边界。
