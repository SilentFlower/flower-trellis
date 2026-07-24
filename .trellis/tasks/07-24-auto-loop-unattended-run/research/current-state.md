# Auto-Loop 当前状态研究

## Runner

- `auto_loop.py` 当前 `SCHEMA_VERSION=1`，run 默认 profile 为 `commit-only`。
- 多任务按显式顺序串行；queue item 支持 pending/running/completed/blocked。
- planning gate 在任务轮到时惰性执行，不会在首个实现 action 前完成全队列预检。
- planning item 当前依次执行 Open Questions、planning readiness、brief freshness、`confirm_brief` 和 `start_task`。
- Open Questions 的 unchecked 项立即 blocked；历史裸列表由 AI semantic review action 判断。
- Check-All 成功/失败通过精确 `record + next` 返回 runner；实现 fix/recheck 默认最多 3 轮。
- terminal `blocked` 表示队列存在 blocked item；completed 仅表示本地提交完成，不改变任务生命周期状态。
- runtime 已使用同目录临时文件、flush/fsync 和 `os.replace` 原子写入。

## Task Lifecycle

- `task.py finish` 只清理当前 session 的 active task pointer，不修改 `task.json.status`。
- `task.py archive` 在目录移动前把 status 改为 completed，并写入 completedAt。
- 因此 auto-loop 不归档时应继续保持任务 `in_progress`，runner item completed 与 Trellis task completed 必须保持区分。

## Finish-Work

- `trellis-finish-work` 当前依次执行 release audit、archive、journal 和可选 bookkeeping push。
- archive 是当前任务的必经动作，适合在 release audit 前增加 decision review。
- direct `task.py archive` 仍需要确定性 guard，避免绕过 skill 的 review 语义。

## 分发

- `vendor/skill-garden/.trellis/0.6` 是 canonical 源；`npm run sync` 生成 `enhancements/0.6` 和 manifest。
- 当前 dogfood 通过 Flower enhance-only 应用生成快照，不应手工修改最终副本。
- `src/lib/copy-scripts.js` 负责 direct script asset 的精细安装别名；新 decision helper 必须同时匹配 auto-loop 和 finish-work。

## 已确认测试缺口

- 现有 runner 测试覆盖两个 in_progress 任务连续执行，但未覆盖多个 planning 任务的批量 prepare。
- 没有依赖图、dirty baseline 分类、持久化 decision log 或归档前 decision review 测试。
- task status 只有 planning 走 start gate，其它未知/完成状态当前会直接落入 implement，需要新增白名单。
