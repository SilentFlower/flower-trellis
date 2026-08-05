# 重构 Trellis worktree 分支隔离

## Goal

让同一 Git 仓库中的多个 worktree 可以分别使用各自分支版本的 Trellis workflow、spec、scripts、
tasks 和平台入口，并通过机器本地注册表完成任务与 worktree 的并行编排。任何 worktree 的分支
切换、更新或删除都不得改变其它 worktree 实际加载的 Trellis 内容。

## Background

当前 `trellis-worktree` 在 linked worktree 缺少入口时，把另一个 worktree 的 `.trellis`、
`.agents`、`.codex`、`.claude` 整目录建立 symlink。该方案解决了“入口不存在导致 skill/hook
无法加载”，但引入了更严重的分支语义错误：目标 worktree 会执行源 worktree 当前分支的规则、
脚本和平台配置；源 worktree 切分支后，目标运行环境会无提示变化或失效。

上一版任务明确未实现跨 worktree 任务绑定和并行调度。本次重构不继续修补 symlink，而是把
“分支版本内容”“worktree 本地运行态”“仓库级机器状态”拆成独立边界。

## Requirements

1. `.trellis`、`.agents`、`.codex`、`.claude`、`.flower` 中受版本或项目配置控制的内容必须由
   当前 worktree 自己的分支提供，不得从其它 worktree 整目录投影或运行时 fallback。
2. `worktree status` 必须优先检查目标 worktree 本地真实目录，并区分：
   `ready-local`、`needs-init`、`needs-migration`、`blocked`、`error`。
3. 当目标分支已经包含真实且有效的 Trellis / 平台入口时，已有目录必须视为本地就绪，不得再按
   `projection-conflict` 处理。
4. 当目标分支缺少 Trellis 时，工具必须返回可执行的本地安装 / 更新建议；不得静默借用其它
   worktree，也不得自动选择另一个分支的 Trellis 版本。
5. 新的准备流程只能创建当前 worktree 的 gitignored 本地运行目录、开发者身份等机器状态，或
   通过 Flower/Trellis 的既有安装和 Plugin replay 流程生成目标分支内容；不得手工复制另一
   worktree 的目录。
6. 现有 `.trellis-worktree.json` schema v1 和其管理的 symlink 必须可诊断。自动迁移仅在 manifest
   有效、symlink 精确匹配、且目标分支自身能重建对应内容时执行；其它情况失败关闭并保留原状。
7. 自动迁移必须事务化：任一步失败时恢复旧 symlink 和 manifest，不留下部分本地目录或混合版本。
8. `untracked_flow.py` 和 workflow-state hook 不得再从其它 worktree 加载 `.trellis`；目标 cwd
   没有本地 Trellis 时应返回稳定的缺失诊断。
9. Flower CLI 必须提供在目标入口缺失时仍可调用的外部 worktree 入口，至少支持
   `status`、`prepare`、`migrate`、`create`、`remove` 和 `--json`。
10. 用户请求“任务使用 worktree 开发”时，worktree 必须在任务规划开始前创建；目标 worktree
    完成本地准备后再在该目录创建 Trellis 任务，避免搬运已产生的未提交规划文件。
11. `create` 必须为任务创建独立分支和 linked worktree，并写入机器本地注册表；一个分支不得被
    两个 worktree 同时占用，一个 worktree 同时只绑定一个活动任务。
12. 仓库级机器状态必须存放在 `git rev-parse --git-common-dir` 下的 Trellis 专用目录，并按
    worktree ID 隔离注册与锁；不得把绝对 worktree 路径写入受版本控制的 `task.json`。
13. `task.json.branch` 继续作为可移植的持久元数据；现有 `worktree_path` 只兼容读取，不再写入
    新的机器路径。任务与本机路径的关系由 common-dir 注册表维护。
14. 当前 `.trellis/.runtime/sessions`、route、untracked 和 auto-loop 状态继续保持 worktree 本地，
    不迁移成未经 worktree 隔离的全仓共享状态。
15. `remove` 默认只允许移除 clean、无活动锁、且任务不处于实施中的 worktree；MVP 不提供绕过
    校验的强制删除。
16. authoring source 仍位于 `vendor/skill-garden/.trellis/0.6/`，并同步 `enhancements/0.6/`、
    dogfood skill/hook/script 和项目规范；不得只修改生成快照。

## Acceptance Criteria

- [ ] 两个 worktree 分别检出具有不同 `.trellis/workflow.md` 内容的分支时，各自 hook、skill、
      spec router 和 task 命令只读取本地分支内容。
- [ ] 一个 worktree 切换分支、更新 `.trellis` 或被删除后，另一个 worktree 的 Trellis 文件内容和
     运行结果保持不变。
- [ ] 目标存在真实本地 `.trellis/.agents/.codex/.claude` 时，`status --json` 返回
      `ready-local`，不创建 symlink 或 `.trellis-worktree.json`。
- [ ] 目标缺少本地 `.trellis` 时返回 `needs-init` 和目标分支本地安装建议，且不会扫描或选择其它
      worktree 作为 runtime source。
- [ ] 有效 legacy manifest + 精确 symlink + 可从目标 HEAD / 本地项目状态重建内容时，`migrate`
      生成真实本地目录、删除旧受管 symlink 和 manifest，并保持幂等。
- [ ] legacy manifest 损坏、symlink 不匹配、目标有用户文件或无法从目标分支重建时，迁移零写入并
      返回稳定 reason 和冲突路径。
- [ ] linked cwd 缺少本地 `.trellis` 时，hook / `untracked_flow.py` 不再回退读取其它 worktree，
      而是返回本地环境未准备的诊断。
- [ ] `flower-trellis worktree create` 创建独立分支和 worktree、完成本地准备、建立 common-dir
      注册和锁边界，并输出在目标目录继续规划的 handoff 信息。
- [ ] `create` 发现分支已被占用、目标目录存在、基线不可解析、注册冲突或准备失败时事务回滚，
      不留下半创建 worktree、branch 或 registry。
- [ ] `remove` 在 dirty、活动任务、活动 session/lock 或注册漂移时拒绝；安全移除后清理本机注册，
      不删除分支和远端引用。
- [ ] 不同 worktree 中的 session runtime、route、untracked 和 auto-loop 状态互不读取或覆盖。
- [ ] 相关 Python/Node 单测、init/update dogfood、快照同步、Patch target 检查、`npm test` 和
      `git diff --check` 全部通过。

## Out of Scope

- 自动 merge、rebase、PR、push 或删除任务分支。
- 在多个 worktree 中同时实施同一个任务。
- 把已进入实施阶段或带未提交代码的现有任务自动搬迁到另一个 worktree。
- 用 common-dir 共享 `.trellis/tasks`、`.trellis/spec`、`.trellis/workspace` 或平台配置。
- 为旧分支猜测应安装的 Trellis 版本；缺少可验证版本证据时必须由用户选择安装 / 升级策略。
- 提供 `--force` 绕过 dirty、活动锁、用户文件冲突或迁移来源不可信等安全门槛。

## Confirmed Context

- 当前 helper 的 `ENTRY_PATHS` 固定为 `.trellis`、`.agents`、`.codex`、`.claude`，并用绝对
  symlink 指向 `sourceRoot`。
- schema v1 manifest 只记录 source/target/path，不记录源分支或 commit，因此不能保证内容稳定。
- 当前 helper 在 linked worktree 已有真实入口时会把它们视为冲突，而不是 branch-local ready。
- 当前 hook 和 `untracked_flow.py` 会从 Git worktree 集合回找其它 `.trellis` 根。
- task schema 已有 `branch` 和 `worktree_path`，但公开 CLI 只有 `set-branch`；机器路径尚无可靠
  生命周期管理，且写入受版本控制的 task 文件不可移植。
- Flower CLI 已支持 `--target`，普通 init/update 与 Plugin replay 已有目标项目写入、事务补偿和
  `.trellis/tasks` / `.trellis/spec` 保留语义，可复用于本地准备而不是另写复制器。
