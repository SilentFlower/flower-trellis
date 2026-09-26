# Brief — 未跟踪任务精确收敛

## Goal

- 让 SessionStart 自动收敛完全未跟踪的旧任务目录，并通过既有精确 Git 事务安全纳入任务记录。

## Scope

- 识别无 tracked files、Git 状态全部为 `??` 且 `task.json` 可纳管的顶层旧任务。
- 按既有任务状态规则补齐 `closeout`。
- 以整个未跟踪任务目录为精确 pathspec 和 fileset 创建 maintenance commit。
- 保持同批次普通已跟踪任务只提交 `task.json`。
- 补充 Python 回归测试，更新生命周期合同，并同步 Skill-Garden 权威源、`enhancements/0.6`、compiled targets 与 dogfood。

## Non-Goals

- 不放宽 closed task 物理 GC 对 dirty/untracked 候选的限制。
- 不自动提交已跟踪任务目录中的无法归属人工修改或混合状态。
- 不提交 Git ignored 文件，不执行 push、release 或 tag。
- 不改变 Close、restore、auto-loop 和普通任务创建行为。

## Key Decisions

- 放宽仅适用于“整个任务目录完全未跟踪”的 legacy reconciliation 候选；已跟踪 dirty 候选继续失败关闭。
- 完全未跟踪候选按整个任务目录提交，避免只提交 `task.json` 而留下残缺任务记录。
- 继续复用临时 index、固定 HEAD/分支引用、expected fileset 校验、候选外指纹、CAS 和 journal 恢复，不新建第二套提交机制。
- Git 可纳管文件集由 NUL 安全的 Git 命令枚举；ignored 文件保留本地且不进入提交。

## Key Context

- 行为权威源是 `vendor/skill-garden/.trellis/0.6/scripts/task_lifecycle.py`，不是当前 `.trellis/scripts/` 生成结果。
- 当前 reconciliation 批量 helper 默认只提交改写的 `task.json`，需要支持显式 pathspec 与 expected fileset。
- 回归测试位于 `test/python/test_task_lifecycle.py`，合同位于 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。
- 当前复现场景是 `.trellis/tasks/09-05-telemetry-roadmap/`；它必须作为候选外既有用户数据被谨慎保留，直到新逻辑经隔离测试验证。

## Risks / Deferred

- 文件集在候选计算与提交之间变化时必须由既有精确校验失败关闭，不能猜测或扩大提交范围。
- dogfood 更新前需确认不会混入两个任务目录之外的用户变更。

## Acceptance

- 完全未跟踪的 planning/completed 旧任务均能补齐正确 `closeout`，整个 Git 可纳管任务目录进入唯一 maintenance commit，且重复运行零写入。
- 未跟踪与已跟踪旧任务可同批收敛，commit fileset 精确符合各自授权边界。
- 已跟踪人工修改、混合状态和 GC dirty 候选继续延后。
- 候选外 staged、dirty、untracked 状态在成功和恢复路径中保持不变。
- 权威源、快照、compiled targets 与 dogfood 一致，相关 Python/JS 检查通过。

## Next Step

- 启动任务后先在 Skill-Garden 权威脚本中实现未跟踪文件集枚举与 reconciliation 提交边界扩展。
