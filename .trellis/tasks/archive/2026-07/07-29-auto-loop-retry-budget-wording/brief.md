# Brief — 修复 auto-loop 重试预算与入口措辞

## Goal

- 修复 auto-loop 在失败预算、入口说明、任务恢复记录和 runtime 跟踪文件上的问题：标称 3 轮 fix/recheck 必须实际允许 3 次 `run_fix`，skill 入口不能暗示读取 Python 源码，auto-loop 结束或阻断后必须把下一步写入 Trellis task，主 tracking JSON 不应膨胀为 AI 容易误读的大型审计文件。

## Scope

- 修改 Skill-Garden 0.6 canonical runner：`vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`。
- 修复 legacy schema 和 schema 2 调度中 `run_fix` 发出前的预算边界，把过早阻断的 `attempts >= MAX_FIX_RECHECK` 调整为与失败记录一致的语义。
- 修改 `retry-blocked`：`retry-budget-exhausted` 作为用户显式可恢复原因；恢复该原因时重置 `attempts.fix_recheck`，避免刚恢复就再次预算耗尽。
- 修改 `trellis-auto-loop` `.agents` 与 `.claude` skill description，把“读取下一步”改为“执行 `.trellis/scripts/auto_loop.py next` 获取 runner action”。
- 在 auto-loop runner 内写入 `task.json.progress`：`commit_only` 成功、队列完成带 blocked、item blocked 时都要记录可扫描的恢复摘要。
- progress 写入严格使用现有 `task_progress.py` 五字段 schema：`updatedAt`、`completedSteps`、`partialStep`、`nextStep`、`notes`。
- 对 auto-loop runtime tracking 做瘦身：`<run-id>.json` 保持为热状态文件，完整 manifest revision 历史迁移/追加到 `<run-id>.manifest.jsonl`，默认 `status/resume` 不内联完整审计历史。
- 保持旧 runtime 兼容：含旧版 `manifest_revisions` 数组的 run 仍能读取、恢复和重试；下次写入时迁移到旁路 audit JSONL。
- 按 canonical 源 -> `npm run sync` -> dogfood 已安装副本的顺序，同步 `vendor/skill-garden/.trellis/0.6`、`enhancements/0.6`、当前项目 `.trellis/scripts` 和平台 skill 副本。
- 补充 Python 回归测试覆盖重试预算、预算耗尽后的显式恢复、terminal/blocked progress 写入、`task_progress.py` 可读性、runtime 主 JSON 瘦身和 audit JSONL 可追溯性。

## Non-Goals

- 不改变 auto-loop 的生命周期语义：auto-loop item 本地提交完成后，Trellis task 仍保持 `in_progress`。
- 不自动 push、archive、finish-work，也不把任务自动标记为 `completed`。
- 不重新设计普通 `trellis-push` 的任务进度同步机制。
- 不降低 artifact-drift、dirty baseline 或 commit-only 审计能力；只是把审计详情移出默认热状态文件。
- 不改变 schema 1/schema 2 runtime 的既有调度字段结构，除必要的 attempts 重置、progress 写入和 manifest history 存储位置外不扩展队列模型。

## Key Context

- `MAX_FIX_RECHECK = 3` 已存在，但发出 `run_fix` 前使用 `attempts >= MAX_FIX_RECHECK`，失败记录处使用 `attempts["fix_recheck"] > MAX_FIX_RECHECK`；两处语义不一致导致实际 fix 次数少于标称预算。
- 同类预算判断同时存在于 legacy schema 和 schema 2 running 调度，必须同步修改。
- 当前 `retry-budget-exhausted` 不是默认 recoverable reason；即使用户显式恢复，旧 `attempts.fix_recheck` 也会导致下一轮立即阻断。
- 7/28 原始会话里源码读取发生在 `commit_only` 后 `artifact-drift` 恢复路径：`record` blocked 后，模型执行 `next` 和两次 `retry-blocked` 仍被 manifest hash 拦截，随后读取 `planning_sha256`、`handoff_sha256`、`cmd_retry_blocked`、`cmd_decide` 和 artifact hash 校验实现。
- `trellis-auto-loop` description 中“从 `.trellis/scripts/auto_loop.py` 读取下一步”的措辞容易在压缩恢复或异常恢复时被误解为读取 Python 源码；运行契约应指向 runner 命令和 JSON action。
- `task_progress.py` 只扫描带 `task.json.progress` 的 `in_progress` task，且只接受五字段 schema；auto-loop 不记录 progress 会让后续恢复过度依赖本机 gitignored runtime。
- progress 只作为恢复提示：成功提交时 `nextStep` 指向显式 finish/archive 或后续人工流程；blocked 时 `partialStep` 记录 reason，`nextStep` 指向 `retry-blocked --run-id <run-id> --task <task>` 等恢复命令。
- 历史 run `.trellis/.runtime/auto-loop/auto-20260728062156.json` 约 822KB，其中 `manifest_revisions` 约 470KB，是主文件膨胀最大来源；调度只需要当前 `manifest_revision/manifest_sha256` 和 item 当前 hash，完整 revision 历史更适合旁路 audit JSONL。
- 默认 `status/resume` 应消费 compact summary；完整审计只在明确 debug artifact-drift 或 audit 时读取。

## Acceptance

- 新增 Python 回归测试证明连续失败链路会发出 3 次 `run_fix` action，并在第 3 次 recheck 仍失败后进入 `retry-budget-exhausted`。
- 新增 Python 回归测试证明 `retry-blocked` 恢复预算耗尽项时会重置 `attempts.fix_recheck`，下一次 `next` 能返回 `run_fix`。
- 新增 Python 回归测试证明 auto-loop terminal/blocked 状态会写入 `task.json.progress`，且 `task.json.status` 保持 `in_progress`。
- progress 能被 `task_progress.py status --task <task> --json` 读取，`nextStep` 明确指出显式恢复、finish/archive 或后续人工流程。
- 新增 Python 回归测试证明多次 manifest revision 后 `<run-id>.json` 不含全量 `manifest_revisions`，`<run-id>.manifest.jsonl` 包含完整 revision 事件和 sha256。
- 新增 Python 回归测试证明旧版含 `manifest_revisions` 数组的 runtime 经一次写入后迁移瘦身，并且 `status/resume/retry-blocked` 仍可用。
- `trellis-auto-loop` canonical、快照和当前 dogfood 已安装副本均不再出现“读取下一步”的误导表述。
- `npm run sync` 后快照与 canonical 源一致，当前 dogfood runner 和 skill 副本同步完成。
- 至少运行 `python3 -m unittest discover -s test/python -p 'test_auto_loop.py'`；若时间允许，再运行 `npm test` 和 `node scripts/check-ai-context-budget.mjs`。

## Next Step

- 继续 Phase 2.1 inline implement：补齐 runtime 瘦身测试，修改 canonical runner 和 skill 文案，运行 focused validation，然后进入 Check-All 路由。
