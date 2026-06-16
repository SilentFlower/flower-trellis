# 调整 trellis-push snapshot bookkeeping 脏工作区规则

## Goal

调整 `trellis-push` 在写入 `last_push_snapshot` 和执行 snapshot bookkeeping commit 时的脏工作区规则：允许父仓存在无关、未暂存的 dirty 文件，但 bookkeeping commit 必须只提交当前任务的 `task.json`，避免因为 `.trellis/config.yaml` 等无关未暂存变更而跳过任务快照。

用户价值：`trellis-push` 可以更稳定地记录推送进度，同时仍然保持“未经确认的文件不会被自动提交”的安全边界。

## Background / Known Context

- 用户指出：`bookkeeping commit/push` 应该可以只针对当前任务的 `task.json`，不必因为父仓存在其它未确认 dirty 文件而完全拒绝写入 snapshot。
- 当前 `trellis-push` 是 skill 文档驱动，主要文件为 `.agents/skills/trellis-push/SKILL.md` 和 `.claude/skills/trellis-push/SKILL.md`。
- 上游同步源在 `vendor/skill-garden/.trellis/0.6/.../trellis-push/SKILL.md`，随包快照在 `enhancements/0.6/.../trellis-push/SKILL.md`。
- 现有 `trellis-push` Step 2 已要求计划中声明 `bookkeeping: 只提交 <task_dir>/task.json`。
- 现有 Step 5.2 又要求写完 snapshot 后，如果父仓 status 显示其它改动就立即停止并询问。这会和“只提交目标 task.json”的边界产生体验冲突。
- 现有 Step 5.3 使用 `git add <task_json_path> [".trellis/config.yaml"]` + `git commit ...`。在已有 staged 文件时，普通 `git commit` 可能把其它 staged 内容一起提交，因此 staged 状态仍必须作为硬阻塞。

## Requirements

- 保留 `trellis-push` 的统一执行计划确认门禁：确认前仍不得写 `task.json`、`git add`、commit、push。
- Snapshot 写入后，允许父仓存在无关、未暂存 dirty 文件；这些文件必须在输出中提示“保留未提交”，但不能阻止只提交目标 task。
- Snapshot bookkeeping commit 必须只包含当前任务的 `<task_dir>/task.json`；如 reconfigure 已在统一计划中确认，也可包含 `.trellis/config.yaml`。
- 如果父仓已有与本次 bookkeeping 无关的 staged 文件，必须停止，避免普通 commit 混入未确认 staged 内容。
- 如果 `<task_dir>/task.json` 在写 snapshot 前已经有未确认改动，必须停止或要求用户确认，避免覆盖/混合他人对同一任务文件的修改。
- 如果存在 merge/rebase 冲突、未合并路径、detached HEAD、无法确认分支等 Git 异常，仍必须停止。
- 禁止使用 `git add -A`、`git add .`、force push。
- 不改变 `last_push_snapshot` schema。
- 不新增 `trellis-push` CLI 或脚本；本次只调整 0.6 `trellis-push` skill 协议和同步副本。
- 更新后保持 skill-garden 源、`.agents` / `.claude` 当前副本、`enhancements/0.6` 快照一致。

## Acceptance Criteria

- [ ] `trellis-push` 文档明确：无关未暂存 dirty 文件不阻塞 snapshot 写入和 task-only bookkeeping commit。
- [ ] `trellis-push` 文档明确：已有无关 staged 文件、冲突状态、目标 `task.json` 预先 dirty，仍会阻塞并要求处理。
- [ ] `trellis-push` 文档中的 bookkeeping commit 命令使用路径限定方式，只提交已确认的 `<task_dir>/task.json`，必要时加已确认的 `.trellis/config.yaml`。
- [ ] `trellis-push` 计划模板和安全机制描述与新规则一致，不再说“其它 dirty 文件必须询问”这种过宽阻塞。
- [ ] 相关 `trellis-push/SKILL.md` 副本保持一致：`vendor/skill-garden` 0.6 源、`.agents`、`.claude`、`enhancements/0.6`。
- [ ] `node scripts/check-snapshot.mjs` 在快照同步后通过，或说明仅因未提交快照 dirty 而预期失败。

## Out of Scope

- 不修改 0.5 变体，除非实现阶段发现当前发布流程要求同步。
- 不把 `trellis-push` 从 skill 文档升级为可执行 CLI。
- 不允许 snapshot commit 混入业务代码或其它未确认 staged 内容。
- 不改变 task archive、journal auto-commit 的规则。
- 不改变 `last_push_snapshot` 的恢复提示规则。

## Notes

- 推荐 MVP：只调整 0.6 `trellis-push` 文档协议，明确使用 pathspec / `git commit --only` 这类只提交目标文件的方式，同时保留 staged/冲突/同文件预脏的硬阻塞。
