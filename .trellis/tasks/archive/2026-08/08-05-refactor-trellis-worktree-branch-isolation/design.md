# 重构 Trellis worktree 分支隔离 - Design

## Architecture

设计拆为四层，禁止跨层偷取其它 worktree 的分支内容：

```text
Flower CLI facade
  -> packaged worktree engine
     -> target-local Trellis / platform content
     -> git-common-dir registry + locks
     -> Git worktree lifecycle
```

1. Flower CLI：在目标缺少 `.trellis` 和平台入口时仍可从外部调用，负责参数解析、用户输出和
   init/update/Plugin replay 编排。
2. Packaged worktree engine：`vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py` 继续作为
   单一诊断与状态机实现；Flower 调用随包快照，项目 skill 调用目标本地副本，避免 Node/Python
   各写一套 worktree 判定。
3. Target-local content：workflow、spec、scripts、tasks、workspace、平台 skill/hook/config 和
   `.flower` 状态全部来自目标 worktree 当前分支。
4. Git common state：只保存机器本地 worktree 注册、任务映射和互斥锁，不承载任何分支版本内容。

## State Boundaries

| 边界 | 内容 | 持久化位置 |
| --- | --- | --- |
| 分支版本内容 | `.trellis/**` 中受版本控制内容、`.agents`、`.codex`、`.claude`、`.flower` | 当前 worktree |
| worktree 本地运行态 | `.trellis/.runtime`、`.developer`、route/untracked/auto-loop 状态 | 当前 worktree，gitignored |
| 仓库机器状态 | worktree 注册、task 映射、创建/删除锁 | `<git-common-dir>/trellis/` |
| 发布运行时 | Flower CLI、捆绑 enhancement、全局 Trellis | npm/global package |

`task.json.branch` 是可移植事实；绝对路径只允许出现在 common-dir registry。现有
`task.json.worktree_path` 保留兼容读取，但新流程不得写入。

## CLI Contract

新增 Flower 自有命令，不透传给上游 Trellis：

```bash
flower-trellis worktree status [--target <path>] [--json]
flower-trellis worktree prepare [--target <path>] [--json]
flower-trellis worktree migrate [--target <path>] [--dry-run] [--json]
flower-trellis worktree create --target <path> --branch <branch> --base <ref> \
  --task-title <title> --task-slug <slug> [--json]
flower-trellis worktree remove --target <path> [--json]
```

`status` 永远只读。`prepare` 只初始化 target-local gitignored 状态并调用已有目标安装/重放能力；
它不从其它 worktree 复制内容。`migrate` 只处理 manifest 可证明受管的 legacy projection。

`create` 在任务目录产生前运行，顺序固定为：Git preflight -> 创建 branch/worktree -> 本地
Trellis readiness -> 在目标创建 planning task -> 写 common registry -> 输出新目录 handoff。
任一步失败按逆序回滚本轮新增状态。当前 AI 会话不伪装成已迁移到新 cwd，用户或调度器必须在
目标目录启动新会话继续规划。

## Status Model

稳定状态和主要 reason：

| status | 含义 |
| --- | --- |
| `ready-local` | 目标使用真实本地 Trellis / 平台入口 |
| `needs-init` | 当前分支没有可用 Trellis，必须在目标分支安装 |
| `needs-prepare` | 分支内容存在，但 gitignored 本地状态或配置未准备 |
| `needs-migration` | 检测到 schema v1 legacy projection |
| `blocked` | 用户路径、混合 symlink、dirty/lock/registry 等冲突 |
| `error` | 非 Git worktree、Git 调用失败、状态损坏等 |

状态输出保留 `targetRoot`、`gitDir`、`gitCommonDir`、`branch`、`head`、`actions`、`conflicts`、
`reason`，删除新流程对 `sourceRoot` 的依赖。Legacy 诊断可以在 `legacy` 子对象中返回旧 source。

## Local Readiness

1. 先用 `lstat` 判断 `.trellis` 是否为真实目录；symlink 一律进入 legacy 或 conflict 分支。
2. 读取目标 `.trellis/.version`、`.trellis/.template-hashes.json`、`.flower/plugin-lock.json` 和
   Plugin state，识别该分支启用的平台；不再用固定四目录要求所有平台同时存在。
3. 已启用平台入口必须是目标本地真实路径。未启用平台缺失是正常状态。
4. `.developer` 和 `.runtime` 等 gitignored 状态可在目标本地创建；开发者身份只能从显式参数、
   目标现有配置或同仓 common registry 的身份记录恢复，不读取另一 worktree 的分支文件。
5. 缺少版本化内容时返回 `needs-init`。Flower facade 给出 init/update 命令，但未经明确写入操作
   不自动选择版本或覆盖冲突。

## Legacy Migration

Legacy 识别条件：目标存在 schema v1 `.trellis-worktree.json`，且 `links[]` 只包含旧白名单路径。

自动迁移必须同时满足：

- manifest 的 `targetRoot` 等于当前目标；
- 每个受管路径仍是指向 manifest source 的 symlink；
- 目标路径没有 symlink 之外的用户内容；
- 当前目标 HEAD、`.flower` lock/state 或目标分支已有 Trellis 元数据能确定本地重建方案；
- Git worktree 和 registry 无活动写锁。

迁移使用项目外临时目录生成候选树，验证后再原子替换。失败时恢复 symlink 和 manifest。无法从
目标分支证明内容来源时返回 `migration-source-unavailable`，不使用旧 `sourceRoot` 内容作为新目录。

迁移成功后删除 schema v1 manifest；新 branch-local 模式不再创建项目根 manifest，机器状态进入
git common registry。

## Git Common Registry

建议布局：

```text
<git-common-dir>/trellis/
├── registry-v1.json
└── locks/
    ├── registry.lock/
    └── <worktree-id>.lock/
```

`registry-v1.json`：

```json
{
  "schemaVersion": 1,
  "worktrees": {
    "<worktree-id>": {
      "path": "/absolute/local/path",
      "gitDir": "/absolute/git-dir",
      "branch": "feat/example",
      "head": "<sha>",
      "task": ".trellis/tasks/08-05-example",
      "trellisVersion": "0.6.x",
      "updatedAt": "<UTC>"
    }
  }
}
```

worktree ID 从 canonical git-dir 派生，不从可移动目录名猜测。锁通过原子 `mkdir` 获取，锁目录内
记录 owner、PID、session 和时间；只有能证明 owner 已退出且超过 TTL 时才允许恢复陈旧锁。
registry 写入使用临时文件、`fsync` 和原子替换。读取时必须与
`git worktree list --porcelain` 交叉验证，陈旧记录只报告，不自动删除仍可能属于其它进程的目录。

## Task And Worktree Lifecycle

- `create` 只接受尚未创建的任务标题/slug，在目标 worktree 完成准备后运行目标分支自己的
  `task.py create`。这避免搬迁当前 worktree 中未提交的 planning artifacts。
- registry 记录 task -> branch/path；目标 `task.json` 只写 `branch`，不写绝对路径。
- 一个 worktree 绑定一个非 completed 任务；同一 task 不得出现在多个活动 registry 记录中。
- 每个 AI session 继续读取目标本地 `.trellis/.runtime/sessions`，不同 worktree 即使 context key
  相同也不会覆盖。
- `remove` 要求 Git clean、无 lock、无 in_progress/planning task 绑定。完成或已解除绑定后仅执行
  `git worktree remove` 和 registry 清理，不删除 branch。

## Hook And Runtime Changes

删除以下跨 worktree 内容 fallback：

- `untracked_flow.py` 的 `_find_root_from_git_worktrees()`；
- workflow-state hook 的 `_find_trellis_root_from_git()` Patch；
- 任何从 git common dir 父目录或 `git worktree list` 选择其它 `.trellis` 的路径。

hook 已经运行但 cwd 无本地 `.trellis` 时，只返回最小 `worktree-local-trellis-missing` 诊断和
Flower status 命令，不加载其它分支 workflow。项目内 `spec_router.py` 继续只读取 cwd 本地 spec。

## Compatibility And Rollback

- schema v1 只读兼容至少保留一个 0.6 小版本周期；新版本不再创建 v1 manifest/symlink。
- 旧 skill 文案、helper、hook Patch、测试和 `config-and-state.md` 必须同步替换，避免新旧语义混用。
- Flower update 的现有事务补偿继续保护 target-local 安装；worktree create/migrate 再包一层精确
  Git/registry 补偿，不扩大到扫描删除整个项目。
- 回滚代码版本后，尚未迁移的 v1 projection 仍可由旧版读取；已经迁移成 local 模式的 worktree
  不依赖新 manifest，旧版最多缺少编排能力，不应破坏本地内容。

## Key Trade-offs

- 不共享整目录会增加每个 worktree 的磁盘占用，但换取正确的分支语义和可复现性。
- MVP 不迁移已有 planning/in-progress 任务，减少未提交任务文件跨工作区移动和 session 指针漂移。
- common registry 只解决机器编排，不作为项目事实来源；clone 到另一台机器后可由 Git worktree
  和目标 task/branch 重新建立。
