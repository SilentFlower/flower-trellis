# 简化 Trellis 提交、进度与收尾流程实施计划

## Implementation Steps

1. 收敛任务契约
   - 以最新 PRD 为唯一行为基线，删除旧 snapshot/merge/push_mode 设计中的冲突描述。
   - 保留 post-check stop、Phase 3.3、Phase 3.4 唯一入口和 auto-loop commit-only 的既有边界。

2. 新增最小任务进度 helper
   - 从 `push_snapshot.py` 提取仍有价值的安全读写能力，新增 `task_progress.py`。
   - 新 schema 只维护 `progress.updatedAt/completedSteps/partialStep/nextStep/notes`。
   - `status` 兼容映射 legacy `last_push_snapshot`；`write` 只改 `progress` 并删除 legacy 字段。
   - 更新 workflow/state recovery 使用 task progress 语义，不再恢复 push mode 或 commit 编排。

3. 重写 `trellis-push` 为最小流程
   - 保留仓库发现、文件归属、exact plan、一次确认、`git commit --only`、普通 push 和显式 commit-only。
   - 计划和结果复用原有总览 → 分仓 → 任务进度 → 保留文件的视觉顺序，但只显示精简后的 commit/push/progress 内容。
   - 用户可见输出将 retained 写为“保留未提交的变更（dirty）”，逐项标注 untracked/unstaged/staged；真正风险单独分区。
   - 分仓标题使用真实 package/仓库名，禁止把内部 `root` / `parent` 别名显示给用户。
   - 删除 merge、`merge_target`、reconfigure、临时目标、snapshot 草案、运行后 hash 回填、父仓 snapshot bookkeeping、Spec review/验证重复展示。
   - 普通全部成功或部分成功/失败后，调用 `task_progress.py`，生成固定 progress commit 并立即 push。
   - 无活动任务时跳过 progress；progress 失败与业务结果分开报告。

4. 收敛 auto-loop 联动
   - 保留 runner profile/action/runtime schema 和 `run_check_all -> run_spec_update -> commit_only` 顺序。
   - 将 profile/task/outstanding action 校验、免确认授权、blocked/failed 和 `record` 回写全部放入 `trellis-auto-loop`。
   - `trellis-push` internal commit-only 只接收 exact files/message 并执行 commit，不读取 runner runtime。
   - 验证 auto-loop 不 push、不生成远端 progress commit。

5. 拆分 release audit 与 finish-work
   - 为 `trellis-release` 增加 `audit-current` 内部模式，复用现有证据核对规则并返回结构化结果。
   - finish-work 自动调用 `audit-current`，删除自身复制的 release 推断正文。
   - finish-work 使用 `task.py archive --no-commit` 与 `add_session.py --no-commit`，再按 exact paths 分别 commit。
   - 自动 push 只依据 finish-work 开始时的 upstream/ahead 基线；删除 `push_mode` 联动和工作区 clean 条件。

6. 更新 workflow 与门禁
   - 保留并强化 Phase 3.4 唯一 `trellis-push` 入口，整段禁用下层 `Proposed commits` / local-only / no-push walkthrough。
   - 将所有 “push snapshot recovery” 文案和 helper 调用切换为 “task progress recovery”。
   - 删除 workflow/skill 中 merge、snapshot JSON、progress `push_mode` 和 finish-work 反向依赖文案。
   - workflow hub/state 保持既有英文协议正文，只修改行为语义；不得整段翻译控制协议。
   - workflow hub 只写“详细格式由 `trellis-push` 管”和必要提交门禁，删除输出顺序、retained 标签、仓库命名与阈值等重复细节。

7. 同步强化源、快照和 dogfood
   - 同步 vendor `.agents` / `.claude` skill 源和 workflow override/state。
   - 用 `task_progress.py` 替换分发中的 `push_snapshot.py`，确认 flower manifest 可精确清理旧脚本。
   - 运行 `npm run sync` 更新 `enhancements/0.6` 与 manifest。
   - 用 enhance-only 路径刷新当前 `.agents` / `.claude`、`.trellis/workflow.md` 和脚本副本。

8. 更新项目 spec
   - 在 `enhancements-model.md` 记录最小 push、远端 progress、auto-loop 边界、release audit-current 和 finish-work Git 基线。
   - 删除旧 snapshot/push_mode/merge 契约，保留 legacy 迁移说明。

9. 执行验证
   - 运行语法、task artifacts、diff、同步和幂等检查。
   - 在临时 Git 仓库验证普通成功、计划外 staged、部分多仓失败、progress sync 失败、commit-only、finish-work ahead/clean baseline。
   - 模拟 legacy `last_push_snapshot` 读取与下一次 progress 写入迁移。
   - 回归普通 `trellis-release` 批次模式与 `audit-current` 模式边界。

## Validation Commands

```bash
npm run sync
git diff --check
git -C vendor/skill-garden diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-13-optimize-trellis-push-flow
node --check src/cli.js
```

补充静态检查：

- `rg` 确认 `trellis-push` 不再包含 merge/reconfigure/merge_target/snapshot JSON/push_mode/runner status/record。
- `rg` 确认 finish-work 不再包含 release 推断正文、`last_push_snapshot` 或 `push_mode`。
- `rg` 确认 workflow/state 只使用 task progress recovery。
- `rg` 确认 workflow-state 无整段中文正文，workflow gate 除明确的用户字面命令外保持既有英文。
- `rg` 确认 workflow hub 不包含 push 结果模板、retained 用户标签、仓库显示名或 8/12 文件阈值，只引用 `trellis-push` 的格式所有权。
- `cmp` / `diff -u` 确认 vendor、enhancements、`.agents`、`.claude` 对应副本一致。
- flower enhance-only 重复执行前后 diff hash 不变。

场景验证：

- 普通单仓：一次确认后 exact commit/push，再独立 progress commit/push。
- 输出样式：计划/结果均有总览、分仓状态、任务进度和保留 dirty 区，且不恢复旧 merge/snapshot/bookkeeping。
- 普通多仓：按顺序执行，全部成功后同步完整 progress。
- 多仓部分失败：保留已成功业务结果，远端 progress 记录 completed/partial/next/failure notes。
- 计划外 untracked/unstaged/staged：保持原状且不阻塞普通 exact commit。
- 用户 commit-only：只本地 commit，不 push、不远端同步 progress。
- auto-loop commit-only：`trellis-auto-loop` 校验并回写 runner；`trellis-push` 不读取 runtime。
- finish-work clean baseline：audit-current、exact archive/journal commits 后自动 push。
- finish-work ahead baseline：exact local commits，跳过自动 push。
- release audit-current：有事项写 task release、无事项 no-op、不确定 Needs human review；普通批次模式不变。
- legacy progress：读取 `last_push_snapshot`，下一次 write 迁移为 `progress`。

## Review Gates

- `trellis-push` 的核心正文应显著短于当前 500 行实现，职责只剩 plan/commit/push/progress trigger。
- auto-loop runtime schema、profile 和 action 名称不得变化。
- progress commit 只能包含当前任务 `task.json`，不得混入其他 dirty/staged 文件。
- 部分成功场景不得把整体错误地标记为 completed。
- finish-work 不得因其他任务文件停止，也不得在 baseline ahead 时自动 push。
- 普通 `trellis-release` 不得被 audit-current 的无确认语义削弱。
- 最终实现必须重新经过 `trellis-check-all`。

## Rollback Points

- `task_progress.py`、workflow recovery 和 task schema migration 必须作为一个整体回退。
- `trellis-push`、`trellis-auto-loop` 与 workflow Phase 3.4 门禁必须作为一个整体回退。
- `trellis-release audit-current` 与 finish-work override 必须作为一个整体回退。
- vendor、enhancements 和当前 dogfood 副本必须保持同一版本语义。
