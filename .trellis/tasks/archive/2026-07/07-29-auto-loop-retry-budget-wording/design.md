# 修复 auto-loop 重试预算与入口措辞 - Design

## Scope

本任务修改 Skill-Garden 0.6 auto-loop runner、auto-loop skill 入口文案、auto-loop task progress 写入和 auto-loop runtime 跟踪文件布局，并同步发布快照和当前 dogfood 安装副本。目标是修复已证实的 off-by-one 预算行为，让 AI-facing 描述准确指向 runner 命令，让 task 本身保留 auto-loop 结束或阻断后的下一步，同时避免主 tracking JSON 膨胀为 AI 容易误读的大型审计文件。

## Technical Design

### Retry Budget

`attempts.fix_recheck` 当前表示已经记录的失败次数。失败记录处在 `attempts["fix_recheck"] > MAX_FIX_RECHECK` 时阻断，因此当计数为 3 时仍应允许一次新的 `run_fix` action。发出 `run_fix` 前的判断应与此语义一致，改为仅在 `attempts > MAX_FIX_RECHECK` 时阻断。

该判断存在于 legacy schema 和 schema 2 running 调度中，两个位置需要保持一致。

### Explicit Retry

`retry-blocked` 是用户显式恢复动作。对 `retry-budget-exhausted` 项重置为 `pending` 时，应将 `attempts.fix_recheck` 清零，使新一轮恢复有完整预算。该原因应加入 recoverable reasons，避免只有加 `--all` 或指定 `--task` 才能恢复。

这仍满足“队列结束后不自动执行第二遍恢复扫描”：恢复必须由用户运行 `retry-blocked` 触发。

### Skill Wording

`trellis-auto-loop` description 中的“从 `.trellis/scripts/auto_loop.py` 读取下一步”改为“执行 `.trellis/scripts/auto_loop.py next` 获取下一步 action”。正文 Run Contract 已经明确 runner 是权威，描述只需去除误导。

### Task Progress Recording

auto-loop 仍保留“本地提交完成不等于 task completed”的生命周期语义。新增的 progress 写入只服务恢复提示，目标是让 `task_progress.py` 能在后续 SessionStart/continue 中发现下一步。

写入位置放在 runner 内部，而不是复用普通 `trellis-push` push 后同步：

- `commit_only` 记录成功后，为当前 item 写入 `task.json.progress`。
- 队列进入 `completed_with_blocked` 时，为 blocked item 写入恢复提示。
- item 因 `retry-budget-exhausted`、`artifact-drift`、`task-status-drift` 等原因 blocked 时，写入 blocked 摘要。

progress 必须严格使用现有 schema：

```json
{
  "updatedAt": "<utc>",
  "completedSteps": ["auto-loop: 本地提交完成 <short-commit>"],
  "partialStep": null,
  "nextStep": "auto-loop 已本地提交；需要用户显式运行 finish-work/archive 或继续后续人工流程",
  "notes": "run_id=<run-id>; commit=<hash>; status=<auto-loop-status>"
}
```

blocked item 使用同一 schema，但 `partialStep` 写 `auto-loop blocked: <reason>`，`nextStep` 写清楚显式恢复命令，例如 `python3 ./.trellis/scripts/auto_loop.py retry-blocked --run-id <run-id> --task <task>`，`notes` 包含 runner summary/detail 的简短摘要。

写入时不新增 `task.json` 顶层字段，不修改 `status`，不触发 push/archive/finish-work。若任务缺少 `task.json` 或 progress schema 写入失败，runner 应把该问题作为诊断信息返回；不能静默丢失“下一步”。

### Runtime Tracking Compaction

`<run-id>.json` 定位为 runner 热状态文件，只保存调度和恢复必需的当前状态。历史 manifest revision 和长审计详情移入旁路 JSONL：

```text
.trellis/.runtime/auto-loop/<run-id>.json
.trellis/.runtime/auto-loop/<run-id>.manifest.jsonl
.trellis/.runtime/auto-loop/<run-id>.events.jsonl
```

本轮先把最大增长源 `manifest_revisions` 从主 JSON 拆出。`_append_manifest_revision()` 仍构造完整 manifest payload 并计算 deterministic sha256，但持久化时：

- 主 JSON 保留 `manifest_revision`、`manifest_sha256`、`manifest_audit_path`、必要时保留最近 1 条轻量 `manifest_tail`。
- 完整 manifest payload 以 JSONL append 到 `<run-id>.manifest.jsonl`，每条包含 `event_id`、`type=manifest_revision`、`revision`、`sha256`、`created_at` 和完整 `payload`。
- 对旧 runtime 中已有的 `manifest_revisions`，下次 `_write_state()` 前先批量导出到 manifest JSONL，再从主 state 删除该数组。

默认输出规则：

- `status` / `resume` 默认仍走 `_compact_summary()`，不展示完整 manifest/audit 历史。
- `--verbose` 可以展示 `manifest_revision`、`manifest_sha256`、`manifest_audit_path` 和有限 `manifest_tail`，但不内联完整 JSONL 历史。
- artifact-drift 调试需要完整历史时，通过 audit 文件路径读取，不把它放进普通 AI 恢复上下文。

兼容要求：

- 含旧 `manifest_revisions` 数组的 runtime 必须仍能 `_load_current_state()`、`status`、`next`、`retry-blocked`。
- 迁移写入必须幂等：同一 revision 不得重复追加到 audit JSONL；可用 `revision` 和 `sha256` 做去重。
- 如果 audit 写入失败，runner 应返回诊断或保守保留当前状态，不得静默丢失审计链。

### Source And Snapshot Sync

按照项目规范，修改顺序为：

1. `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`
2. `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md`
3. `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-auto-loop/SKILL.md`
4. `npm run sync` 生成 `enhancements/0.6`
5. 同步当前 dogfood 已安装副本：`.trellis/scripts/auto_loop.py`、`.agents/skills/trellis-auto-loop/SKILL.md`、`.claude/skills/trellis-auto-loop/SKILL.md`

## Compatibility

- schema 1 与 schema 2 的 existing runtime 均保留字段结构。
- `attempts.fix_recheck` 字段类型不变。
- `retry-blocked` 只在用户显式调用时重置预算，不改变自动调度终态。
- `task.json.progress` 使用现有 `task_progress.py` schema，任务归档语义不变，status 仍由 `task.py`/finish/archive 流程管理。
- 旧 runtime 的 `manifest_revisions` 兼容读取，下一次写入迁移到 audit JSONL；主 JSON 热状态字段保持向前可读。

## Validation

- `python3 -m unittest discover -s test/python -p 'test_auto_loop.py'`
- `python3 ./.trellis/scripts/task_progress.py status --task <fixture-task> --json` 或等价单测断言 progress 可读
- 断言 `<run-id>.json` 不含全量 `manifest_revisions`，且 `<run-id>.manifest.jsonl` 包含完整 revision 事件
- `npm run sync`
- `npm test` 或至少相关 JS/Python 单测和 `node scripts/check-ai-context-budget.mjs`
