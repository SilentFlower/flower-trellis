# Brief — 重构 Trellis worktree 分支隔离

## Goal

- 让多个 Git worktree 分别使用各自分支版本的 Trellis 与平台入口，并通过机器本地注册完成任务并行编排；任何 worktree 的分支变化都不得改变其它 worktree 的 Trellis 运行环境。

## Scope

- 将 `worktree_setup.py` 从跨 worktree 整目录 symlink 投影重构为 target-local readiness 状态机，支持 `ready-local`、`needs-init`、`needs-prepare`、`needs-migration`、`blocked` 和 `error`。
- 让 `.trellis`、`.agents`、`.codex`、`.claude`、`.flower` 的版本化内容完全属于当前 worktree 分支；`.trellis/.runtime` 等会话状态继续保持 worktree 本地。
- 移除 workflow-state hook 和 `untracked_flow.py` 从其它 worktree 加载 `.trellis` 的 fallback。
- 为 schema v1 `.trellis-worktree.json` 和受管 symlink 提供只读诊断及事务化迁移；只有目标分支自身能证明并重建内容时才自动迁移。
- 在 Flower CLI 新增外部可达的 `worktree status/prepare/migrate/create/remove` 命令，复用随包 Python engine、已有 target 安装、Plugin replay 和事务补偿能力。
- 在 Git common dir 建立机器本地 worktree registry 与原子锁，记录 task、branch、path、HEAD 和 Trellis version；受版本控制的 `task.json` 只保存 branch，不写绝对路径。
- `create` 在任务规划开始前创建独立 branch/worktree、准备目标本地 Trellis、在目标创建 planning task，并输出新目录会话 handoff；`remove` 仅处理 clean、无活动任务/锁的 worktree，保留 branch。
- 从 Skill-Garden vendor 权威源更新 skill、helper 和 hook Patch，再同步 enhancements、dogfood、规范与测试。

## Non-Goals

- 不自动 merge、rebase、PR、push 或删除任务分支。
- 不允许多个 worktree 同时实施同一个任务。
- 不自动搬迁已有 planning/in-progress 任务或带未提交代码的任务。
- 不通过 common-dir 共享 tasks、spec、workspace、平台配置或 active session runtime。
- 不猜测旧分支应安装的 Trellis 版本，也不提供绕过 dirty、锁、用户路径冲突或不可信迁移来源的 `--force`。

## Key Decisions

- 废弃整目录 symlink projection；分支语义优先于减少磁盘占用。
- 缺入口时由 Flower CLI 作为外部 bootstrap，项目内 skill 只负责诊断路由，不能依赖另一个 worktree 作为 runtime source。
- common-dir 只保存机器编排状态；session、route、untracked 和 auto-loop 状态继续留在各自 worktree。
- schema v1 迁移不能把旧 `sourceRoot` 内容复制成本地结果；无法从目标 HEAD 或目标项目状态证明来源时失败关闭。
- worktree 在 task 创建前建立，避免跨工作区搬运未提交规划文件；首版不支持既有任务 attach/move。
- `task.json.worktree_path` 只兼容读取，新流程以 common registry 保存本机绝对路径。

## Key Context

- 当前 helper 固定投影 `.trellis/.agents/.codex/.claude`，manifest 不记录 source branch/HEAD，且 linked worktree 的真实本地入口会被判为 conflict。
- 当前 hook 和 `untracked_flow.py` 会通过 Git worktree 集合回找其它 `.trellis`，必须与 helper 同步移除跨分支 fallback。
- Flower CLI 已支持 `--target`，init/update、Plugin replay 和 update transaction 可复用；新增 `worktree` 必须成为 Flower 自有命令，不能落入上游 Trellis 透传。
- task schema 已有 `branch` 和 `worktree_path`，公开命令只有 `set-branch`；active task 当前按 worktree 本地 `.trellis/.runtime/sessions/<context-key>.json` 存储。
- authoring source 位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/` 和当前 dogfood 是生成/安装结果。

## Risks / Deferred

- legacy migration、Git worktree create/remove 和 registry 写入跨越文件系统与 Git 状态，必须采用精确 preflight、原子锁和逆序补偿，不能误删预先存在对象。
- common registry 的锁需要跨平台无依赖实现；设计采用原子 `mkdir` 和可验证 stale-owner 恢复，无法可靠实现时首版应阻断并发写。
- 旧分支没有可验证 Trellis 来源时只返回 `needs-init` 或迁移阻断，由用户选择安装版本。
- 已有任务 attach/move、强制 remove、自动 Git 集成和跨机器 registry 同步延后。

## Acceptance

- 两个分支拥有不同 workflow/spec/platform 内容时，各 worktree 只加载本地版本；任一 worktree 切换、更新或删除不影响另一个。
- 真实本地入口返回 `ready-local` 且零 symlink/manifest 写入；缺本地 Trellis 返回 `needs-init`，不扫描其它 worktree 作为来源。
- legacy projection 在来源可证明时事务化迁移并幂等；manifest 损坏、symlink 漂移、用户冲突或来源不可证明时零写入并返回稳定诊断。
- linked cwd 缺本地 `.trellis` 时，hook/untracked 不再读取其它分支。
- `create` 正确创建独立 branch/worktree、目标 planning task 和 common registry；失败不残留半创建 branch/worktree/task/registry。
- `remove` 对 dirty、活动任务/session/lock 和 registry 漂移失败关闭；成功后清理注册但保留 branch。
- 不同 worktree 的 session、route、untracked 和 auto-loop 状态互不污染；Python/Node 测试、dogfood、快照/Patch 检查、完整 `npm test` 和 diff check 全部通过。

## Next Step

- 用户确认本 Brief 后运行 `task.py start`；进入实现阶段后先加载 `trellis-before-dev`，从状态契约和 Python worktree engine 开始，随后处理 hook fallback、Flower CLI、生命周期、迁移和完整验证。
