# Worktree Branch Isolation Findings

## Current Behavior

- `worktree_setup.py` 固定处理 `.trellis`、`.agents`、`.codex`、`.claude`，目标缺失时创建指向
  另一 worktree 的绝对 symlink。
- schema v1 `.trellis-worktree.json` 记录 `sourceRoot`、`targetRoot` 和 links，不包含 branch/HEAD。
- source 解析优先 Git common dir 主 worktree和 `git worktree list` 中其它 `.trellis`，早于 target
  自身，因此 linked worktree 的真实本地入口会被归为 conflict。
- workflow-state hook 和 `untracked_flow.py` 在 cwd 缺 `.trellis` 时回退读取其它 worktree runtime。
- 当前测试使用“主 worktree 有未追踪入口、linked worktree 完全缺失”的 fixture，只验证了入口可用，
  没有覆盖两个分支分别修改 workflow/spec/scripts 后的隔离性。

## Existing Reusable Contracts

- Flower CLI 已有 `--target` 解析和自有命令动态 dispatch。
- Flower init/update 能在指定目标运行上游 Trellis，并通过 Plugin runtime 生成已启用平台内容。
- Update transaction 已覆盖 Trellis、平台 root、`.flower` 和 Plugin mutation，并保护 tasks/spec。
- Task schema 已有 `branch`；active task 与 route/untracked 状态位于 worktree 本地
  `.trellis/.runtime/sessions/<context-key>.json`。
- `git rev-parse --git-common-dir` 已在 Python helper 中有兼容旧 Git 的实现，可提取为 common utility。

## Prior Decision Revisited

上一版 worktree 任务选择 symlink，是因为 linked worktree 缺平台入口时，本地 skill/hook 无法启动，
同时明确不实现跨 worktree 任务绑定。当前讨论补充了当时未覆盖的不变量：不同分支的 `.trellis`
和平台入口可以不同，源 worktree 切分支不得改变目标环境。因此这次不是修复 symlink 的 source
选择，而是废弃整目录 projection，把外部 bootstrap 放到 Flower CLI。

## Design Consequences

- 分支内容必须 target-local；common-dir 只保存机器编排状态。
- 缺入口的目标不能依赖项目内 skill，因此 Flower CLI 必须成为可达入口。
- Legacy 自动迁移必须从目标 HEAD / 目标项目状态重建，不能把旧 sourceRoot 内容固化为本地副本。
- 任务 worktree 应在 task planning 文件产生前创建；首版不自动搬迁已有 planning/in-progress 任务。

## Source Routing

- `.trellis/spec/flower-trellis/cli/config-and-state.md`：读取
  `Scenario: Linked Worktree Entry Projection` 和 update transaction / preserve 相关章节；实现时把
  projection scenario 重写为 branch-local readiness、legacy migration 和 common registry。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`：读取 Idempotency、Patch Engine、共享 hook
  Patch 和 generated snapshot 一致性章节；不得只改 compiled target。
- `.trellis/spec/flower-trellis/cli/module-guidelines.md`：Flower command/lib 的导出、JSDoc 和分层规范。
- `.trellis/spec/flower-trellis/cli/quality-guidelines.md`：Node/Python、dogfood、snapshot 和 diff 检查。
