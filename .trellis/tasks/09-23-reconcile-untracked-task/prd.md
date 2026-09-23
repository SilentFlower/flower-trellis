# 未跟踪任务精确收敛

## 目标

让 SessionStart 的旧任务生命周期收敛能够处理“整个顶层任务目录均未被 Git 跟踪”的合法任务，不再把它误判为 `candidate-dirty`；收敛后的任务目录必须通过既有精确提交事务一次性纳入 Git，同时不影响候选目录外的任何 staged、dirty 或 untracked 状态。

## 背景

- 当前 `reconcile_legacy_tasks()` 只允许无变更的已跟踪任务，或能由 auto-loop 证据严格归属的 `task.json` 变更。
- `.trellis/tasks/09-05-telemetry-roadmap/` 是完整未跟踪的 planning 任务，缺少 `closeout`，SessionStart 因先命中 path status 而返回 `candidate-dirty`。
- 现有 maintenance 提交已经使用临时 index、固定完整分支引用、固定 HEAD、精确文件集校验、`commit-tree` 与 `update-ref` CAS，并校验候选外 index/worktree 指纹。
- 当前 reconciliation 只把改写的 `task.json` 传给精确提交层；若要处理完整未跟踪任务，必须显式扩大该候选的 pathspec 和 expected fileset。

## 需求

1. 仅当顶层旧任务目录在 HEAD/index 中没有任何已跟踪文件，且 Git 状态全部为未跟踪时，允许自动收敛。
2. 收敛继续按任务状态生成既有 `closeout`：planning/in_progress 写 `pending`，completed 走既有 Close 评估。
3. 对完全未跟踪候选，以整个任务目录作为精确 pathspec；提交文件集为该目录内 Git 可纳管的全部未跟踪文件，并包含已补齐的 `task.json`。
4. 同一批次中的普通已跟踪旧任务仍只提交各自的 `task.json`；完全未跟踪候选与普通候选可以在一次 reconciliation 精确提交中共存。
5. 已跟踪任务中的无法归属修改、混合 tracked/untracked 状态、auto-loop 证据不匹配及 GC dirty 候选继续延后，不扩大其授权边界。
6. 精确提交的事务恢复、候选外 staged/dirty/untracked 保留、分支/HEAD CAS、文件集校验和幂等行为必须保持不变。
7. 修改 Skill-Garden 0.6 权威源，随后同步 `enhancements/0.6/`、编译目标与当前项目 dogfood；不得只修改 `.trellis/scripts/` 生成结果。
8. 更新 task closeout/GC 项目规范，明确完全未跟踪旧任务的收敛合同。

## 非目标

- 不放宽物理 GC 对 dirty 或 untracked closed task 的限制。
- 不自动提交已跟踪任务目录中的普通人工修改。
- 不提交任务目录中的 Git ignored 文件。
- 不改变 Close、restore、auto-loop 或普通任务创建行为。
- 不执行远程 push 或软件包发布。

## 验收标准

- [ ] 完全未跟踪的 planning 旧任务会补齐 `closeout=pending`，整个 Git 可纳管任务目录出现在唯一的 maintenance commit 中，结果不再包含 `candidate-dirty`。
- [ ] 完全未跟踪的 completed 旧任务仍使用既有 Close 评估，并与其余任务文件一起精确提交。
- [ ] 未跟踪任务与已跟踪旧任务可在同一批次收敛，提交文件集精确等于“未跟踪任务全目录文件 + 已跟踪任务的 `task.json`”。
- [ ] 已跟踪任务存在额外人工修改时仍返回 `candidate-dirty`，混合 tracked/untracked 候选也不被自动纳入。
- [ ] 候选目录外的 staged、dirty 和 untracked 内容在成功提交及中断恢复场景下保持不变。
- [ ] reconciliation 重复运行零写入、零新提交。
- [ ] 权威源、同步快照、编译目标和 dogfood 脚本内容一致，相关 Python/JS 检查通过。
