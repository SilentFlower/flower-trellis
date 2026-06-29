# Brief — Auto loop commit and route state fixes

## Goal

- 修复 `trellis-auto-loop` 在 commit-only、route 决策、完成态提示和 stale runtime 指针上的设计缺陷，保持“显式启动、自动推进到本地提交、不自动归档”的边界，并不绕过 `trellis-route` 与 `trellis-push`。

## Scope

- 调整 auto-loop 完成态输出，区分“auto-loop item 已提交”与“任务已归档完成”；最终 done 只做非阻塞 finish-work 提示，多任务队列不中途停住。
- 让 auto-loop commit-only 通过 `trellis-push` 统一边界执行；由 AI 基于任务与 diff 输出提交计划，`trellis-push` 做 Git 状态预检和精确提交，不安全时当前任务暂停/blocked 并说明原因。
- 保证单个任务的 Git 状态污染只影响该任务：runner 记录 failed/blocked/skipped 后继续推进队列里的后续任务，只有全局性仓库/脚本问题才停止整个 run。
- 移除 auto-loop 默认 subagent/check-all-subagent route 授权；由 `trellis-auto-loop` skill 在启动前判断 route 准备度，缺少 runtime 决策或用户偏好时先走 `trellis-route` 获取真实决策。
- 修复 `.trellis/.runtime/auto-loop/current.json` stale pointer：runner completed/stopped 后清理或失效，`route_state.py` 忽略非 running pointer 并 fallback 到唯一 running run。
- 在 auto-loop runtime 中增加关键决策摘要，记录真实 route、commit-only 计划、snapshot/work commit、未归档任务提示、Git 预检失败/blocked/skipped 摘要，不记录完整模型思维链。
- 更新 skill-garden 0.6 源、`enhancements/0.6` 快照、当前 dogfood 副本和相关 spec 文档。

## Non-Goals

- 不让 auto-loop 自动执行 finish-work、archive、push、merge、release。
- 不改变 `trellis-route` 的用户交互选项语义。
- 不引入长期守护进程、外部数据库或网络服务。
- 不重构整个 `trellis-push` 为完整 CLI；只补足 auto-loop commit-only 必需的确定性边界。

## Key Context

- auto-loop runner 是调度器，不是 route 决策器，也不是 push 实现器；`trellis-auto-loop` skill 负责启动前 route 准备度判断。
- 真实 route 决策来自 `trellis-route`：runtime hit、用户 `.trellis/.route-prefs.tmp`，或正常询问/fallback 后写回 runtime。
- auto-loop commit-only 需要校验 `auto_loop.py status`：`run_status=running`、`profile=commit-only`、`outstanding_action.action=commit_only`；文件归属由 AI 基于任务 artifacts 与 diff 判断，`trellis-push` 预检确认提交计划不会混入非本任务改动。
- commit-only 预检失败只影响当前 item；多任务队列应继续寻找后续 pending item，最终 summary 汇总 completed 与 blocked/skipped。
- 修改应先落在 `vendor/skill-garden/.trellis/0.6` 源，再 `npm run sync` 到 `enhancements/0.6`，最后同步当前项目 `.trellis/scripts` / `.agents/skills` dogfood 副本。
- 风险文件包括 `auto_loop.py`、`trellis-auto-loop/SKILL.md`、`route_state.py`、`trellis-push/SKILL.md`、`enhancements/0.6/**` 和 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。

## Acceptance

- auto-loop 新 run 默认不再写入 subagent/check-all-subagent 形式的 `route_authorization`。
- 无 runtime route 决策、无个人偏好时，`trellis-auto-loop` skill 启动前先通过 `trellis-route` 产生真实决策；runner 不静默默认 inline 或 subagent。
- 有个人 `.trellis/.route-prefs.tmp` 时，auto-loop 路由复用与普通 `trellis-route` 一致，并把真实 resolved mode 写入 runtime。
- `commit_only` action 通过 `trellis-push` 统一边界执行；预检能识别可能混入非本任务改动的 Git 状态，不引入额外提交 helper。
- 单个任务 commit-only 预检失败时，runner 记录该任务 failed/blocked/skipped，并继续队列后续任务；不得因一个任务的 Git 污染停止整个 auto-loop run。
- 多任务队列中第一个任务 commit-only 后继续下一个任务，不等待 finish-work；最终 done 汇总未归档任务。
- run completed/stopped 后 `current.json` 被清理或标记失效；`route_state.py` 遇到 stale pointer 会忽略并扫描唯一 running run。
- auto-loop runtime 能展示关键决策摘要，且不包含完整模型思维链。
- Python 语法检查、`npm run sync`、同步对比和 `git diff --check` 通过。

## Next Step

- 请确认 planning artifacts 和本 brief；确认后运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/06-29-auto-loop-commit-route-fixes`，随后进入 `trellis-route(implement)`。
