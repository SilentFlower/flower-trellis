# 修复 auto-loop 重试预算与入口措辞

## Goal

修复 auto-loop 在失败预算、入口说明、任务恢复记录和 runtime 跟踪文件上的可观察问题，避免无人值守任务在标称 3 轮预算下只执行 2 次 fix，降低 AI 误把“获取下一步”理解为读取 `auto_loop.py` 源码的概率，让 Trellis task 记录 auto-loop 结束或阻断后的下一步，并避免 AI 默认读取数百 KB 的内部审计 JSON。

## Background

- 用户反馈：升级后 auto-loop 场景中 AI 自行读取 `auto_loop.py`，并且最大失败次数重试不是 3 次而像是 2 次。
- 代码证据：`.trellis/scripts/auto_loop.py`、`enhancements/0.6/scripts/auto_loop.py`、`vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py` 均定义 `MAX_FIX_RECHECK = 3`，但发出 `run_fix` 前使用 `attempts >= MAX_FIX_RECHECK` 阻断；而失败记录处使用 `attempts["fix_recheck"] > MAX_FIX_RECHECK` 阻断。这会在第三次失败后不再发出第三个 `run_fix` action。
- 历史证据：初始 auto-loop runner 版本已存在同类 `attempts >= MAX_FIX_RECHECK` 判断，因此这不是本次 `0.5.1-beta.1 -> 0.5.1` self-update 新引入的问题。
- 历史会话证据：7/28 原始 Codex 会话中，`auto_loop.py record --action commit_only` 因 `artifact-drift` 阻断后，模型先执行 `next` 和两次 `retry-blocked`，随后在 09:31-09:35 读取 `auto_loop.py` 的 `planning_sha256`、`handoff_sha256`、`cmd_retry_blocked`、`cmd_decide` 和 artifact hash 校验实现。该源码读取是 artifact-drift 恢复路径触发的调试行为，不是正常 `record -> next` 循环的必要步骤。
- 入口文案证据：`trellis-auto-loop` skill description 写着“从 `.trellis/scripts/auto_loop.py` 读取下一步”，容易在压缩恢复或异常恢复时被理解为读取 Python 源码；运行契约实际要求执行 runner 命令并使用其 JSON action。
- 任务记录证据：`trellis-push` 明确规定 auto-loop 内部 `commit-only` 跳过普通 push progress 同步，auto-loop 主要写 runtime/decision log，并保持 Trellis task 为 `in_progress`。但 `task_progress.py` 只扫描带 `task.json.progress` 的 `in_progress` 任务；如果 auto-loop 不把终态或阻断后的下一步写进 task，后续 SessionStart/continue 会过度依赖本机 gitignored runtime，不利于恢复。
- 跟踪文件证据：历史 run `.trellis/.runtime/auto-loop/auto-20260728062156.json` 约 822KB，其中 `manifest_revisions` 约 470KB，`queue` 约 58KB，`repositories` 约 35KB。`manifest_revisions` 主要用于审计和 hash 追溯，普通 `resume/status/next` 不应默认承载或诱导 AI 读取这类大字段。

## Requirements

- R1：单个 auto-loop item 在进入 fix/recheck 恢复链后，标称 `MAX_FIX_RECHECK = 3` 必须实际允许 3 个 `run_fix` action，而不是第 3 次失败后提前阻断在第 2 个 fix 后。
- R2：当用户显式通过 `retry-blocked` 恢复因 `retry-budget-exhausted` 阻断的 item 时，该 item 必须获得新的 fix/recheck 预算，不能因旧 `attempts.fix_recheck` 保留为 3 或 4 而立即再次阻断。
- R3：`retry-budget-exhausted` 应作为用户显式 `retry-blocked` 可恢复原因处理；仍不得自动执行第二遍恢复扫描。
- R4：`trellis-auto-loop` skill 的 description 必须把恢复下一步表述为“执行 `.trellis/scripts/auto_loop.py next` 获取 runner action”，避免暗示读取 Python 源文件。
- R5：canonical 源、发布快照和当前 dogfood 安装副本必须同步一致：先改 `vendor/skill-garden/.trellis/0.6`，再同步 `enhancements/0.6` 和当前项目 `.agents/.claude/.trellis/scripts`。
- R6：auto-loop 在 item 本地提交完成、队列完成带 blocked、或 item 因可恢复/不可恢复原因 blocked 时，必须向对应 Trellis task 的 `task.json.progress` 写入可扫描的恢复摘要。
- R7：progress 写入必须使用现有 `task_progress.py` schema：`updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes`，不得新增未支持字段。
- R8：不改变 auto-loop 的任务生命周期语义：auto-loop item 完成本地 commit 后，Trellis task 仍保持 `in_progress`；progress 只记录下一步，不自动 push、archive、finish-work 或把任务标记为 `completed`。
- R9：auto-loop 主跟踪文件 `<run-id>.json` 必须保持为热状态文件，不再无限增长保存全量 `manifest_revisions` 历史；历史 manifest revision 进入旁路 audit JSONL。
- R10：主跟踪文件应保留 runner 调度和恢复所需的当前状态：当前 manifest revision/hash、queue item 当前状态、attempts、blocked reason、commit、必要 hash 与最近 action；审计详情通过引用或旁路文件读取。
- R11：默认 `status`/`resume` 输出不得加载或展示完整 audit 历史；`--verbose` 可以展示有上限的摘要，但完整审计只能通过明确 debug/audit 路径读取。
- R12：旧版含全量 `manifest_revisions` 的 runtime JSON 必须可读；下次写入时应迁移/瘦身，不能破坏已有 blocked/retry/resume。

## Acceptance Criteria

- [ ] 新增 Python 回归测试证明连续失败链路会发出 3 次 `run_fix` action，并在第 3 次 recheck 仍失败后进入 `retry-budget-exhausted`。
- [ ] 新增 Python 回归测试证明 `retry-blocked` 恢复预算耗尽项时会重置 `attempts.fix_recheck`，下一次 `next` 能返回 `run_fix`。
- [ ] `trellis-auto-loop` skill 的 `.agents` 与 `.claude` canonical/快照/已安装副本均不再出现“读取下一步”的误导表述。
- [ ] 新增 Python 回归测试证明 auto-loop terminal/blocked 状态会写入 `task.json.progress`，且 `status` 保持 `in_progress`。
- [ ] progress 内容能被 `task_progress.py status --task <task> --json` 读取，`nextStep` 明确指出显式恢复或 finish/archive 的下一步。
- [ ] 新增 Python 回归测试证明多次 manifest revision 不会让 `<run-id>.json` 保留全量 `manifest_revisions` 历史，旁路 audit JSONL 可读取完整 revision 事件。
- [ ] 新增 Python 回归测试证明含旧版 `manifest_revisions` 的 runtime 被 `_write_state()` 或等价 CLI 流程迁移后仍可 `status/resume/retry-blocked`，且主 JSON 不再保存大历史数组。
- [ ] `npm run sync` 后快照与 canonical 源一致，相关已安装副本同步到当前项目。
- [ ] 至少运行 `python3 -m unittest discover -s test/python -p 'test_auto_loop.py'`；若时间允许运行 `npm test` 和 AI context budget checker。

## Notes

- progress 写入是本任务新增范围，但只解决“下一步可恢复提示”；不重新设计普通 `trellis-push` 的任务进度同步机制。
- runtime 瘦身只改变内部持久化布局和默认输出体积，不降低 artifact-drift、dirty baseline 或 commit-only 审计能力。
