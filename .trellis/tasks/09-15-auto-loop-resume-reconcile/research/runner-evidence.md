# Runner 现状与事故证据

## 事故链

- 项目 `/root/project/xhgj-ai-harness-poc`，run `auto-20260912160337`，C 任务 `09-11-赵维豪-w00-003-workflow-v2-c-runtime`。
- 会话 `01a0962e-205a-7aa0-b1f7-9be6ff2c28ee` 的原始工具记录 3556：`decide --task .trellis/tasks/09-11-赵维豪-w00-003-workflow-v2-c-runtime ... --file implement.md --file design.md`，随后实际写任务目录内文档。
- 记录 3701：上下文恢复运行 `next`；19:58:32 UTC（北京时间 2026-09-13 03:58:32）C 因 artifact-drift 被阻塞，B、D 因依赖关系被阻塞。
- 归档交接位于该项目 `.trellis/tasks/archive/2026-09/09-11-赵维豪-w00-003-workflow-v2-c-runtime/recovery/2026-09-13-artifact-drift/README.md:7`。当时仅恢复文档与用户触发 retry-blocked，未改 runner。
- 后续 D 在正确登记 DEC-0002 后也于 `2026-09-13T03:56:47Z`、`03:57:30Z` 两次发生恢复漂移；`06:07:52Z` 才在 record 消费决策并重绑。这支持“正确路径 + pending decision + next”也必须覆盖。

## Canonical 事实

以下行号以规划时 `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py` 为准：

| 位置 | 现状及影响 |
| --- | --- |
| `781` `_task_artifact_hashes` | 四份任务文档的逐文件摘要使用 `.::<完整任务路径>` 键。 |
| `791` `_normalize_record_file` | 裸路径补 `.::`，不会以 task 目录为锚点；当前只去前缀，不完整校验安全路径。 |
| `1861` `_make_item` | 保存 fix_recheck、artifact_reconcile、commit_repair；恢复新增字段需可选且不破坏旧字段。 |
| `1964` `_remember_action` | 每次 next 都重设 issued_at；Check 再次读取并覆盖 artifact baseline，存在掩盖漂移的风险。 |
| `2250` `_next_running_v2` | 先比 aggregate hash，漂移就 block；不消费或识别 pending decision，再发当前 step action。 |
| `2534` `cmd_resume` | 仅摘要和会话关联；不会执行纠正，默认摘要来自 `_compact_summary`。 |
| `2605` `cmd_retry_blocked` | 用户显式恢复终态后清 outstanding，重新 prepare；不能用来代替 action 内纠正。 |
| `3298` `_protected_path_conflicts` | 精确文件交集；新路径入口须额外考虑非规范路径与父目录软链绕过。 |
| `3311` `_consume_protected_baseline_drifts` | 会更新 protected current_sha256 并写历史；纯诊断不能直接调用并悄悄消费变化。 |
| `3354` `_consume_pending_artifact_decision` | record 才对比 pending 逐文件 baseline；无变化会清 pending，有未经登记变化返回 unauthorized，全部已登记则追加 manifest revision。 |
| `3412` `_consume_check_doc_remediation` | 只允许当前 implement/brief，必须精确等于实际变化，且不能与 pending decision 混用。 |
| `3495` `_record_artifact_drift` | 仅 Check 可 retryable，前三次返回重录，第 4 次 terminal；其他 action 直接 block。 |
| `3581` `cmd_record` | 校验原 action 后才进行 protected、DOC、pending decision、aggregate hash 与结果回写。 |
| `3881` `cmd_decide` | 只检查队列归属、已有 pending、protected 交集，再 append_decision；文件路径误填到根目录也能登记。 |

`decision_log.py:269` 的 `append_decision` 接受 artifact 或代码文件路径，不能把已有 `--file` 收窄成仅四份文档。`load_events` 严格接受 decision/review；如做路径纠正审计，优先追加普通 decision，保留原选择并引用原 ID，避免新建事件 schema。decision 写入使旧 review digest 失效，符合现有归档审计。

## 所有权与约束

- 唯一作者源是 `vendor/skill-garden/.trellis/0.6`；Flower 的 `enhancements/0.6`、dogfood runner 和 skill 是投影。
- 新增恢复字段不能把持久化 run/item 状态改为 retryable；该词只用于命令诊断结果，route 仍需 running。
- 原规范 `enhancements-model.md:2393` 的“非 Check / next 漂移 terminal”需要局部更新；同节仍有旧 task lifecycle 表述，实际 runner 已写 completed，不能依旧文本回退生命周期。本任务只更新恢复契约，既有完成态保持。
- 不运行原项目的 next/retry/record；历史事故只提炼匿名临时 Git fixture，不复制项目数据、凭据或大型日志。
- 当前主仓原有三个 untracked 目录已由 task_intent baseline 保存，vendor 初始 clean；规划与后续提交均保留它们。
