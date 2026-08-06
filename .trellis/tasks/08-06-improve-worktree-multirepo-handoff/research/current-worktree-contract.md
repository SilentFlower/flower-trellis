# Current Worktree Contract Research

## Confirmed Evidence

- `src/commands/worktree.js:10-19`：facade 支持固定命令和参数；当前没有 `--yes`。
- `src/commands/worktree.js:50-57`：create 要求 branch/task 参数，但 `--dry-run` 仅允许 migrate。
- `src/commands/worktree.js:91-100`：人类输出只展示 target/branch/task/handoff，缺少来源仓库和 base 身份。
- `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:769-782`：create 直接校验并准备写入；base 缺省由 parser 提供 `HEAD`。
- `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:790-849`：一次调用创建 branch/worktree、runtime、task 和 registry。
- `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:879-894`：创建结果缺少来源仓库身份，handoff 只返回 `cd` 命令。
- `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:1137-1146`：Python parser 将 `--base` 默认设为 `HEAD`，没有确认 flag。
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-worktree/SKILL.md:27-34`：Skill 直接执行 create，然后要求在目标 cwd 开新会话，没有创建前确认步骤。
- `.trellis/spec/flower-trellis/cli/config-and-state.md:507-509`：规格只定义写入事务顺序，没有用户确认门禁。
- `.trellis/scripts/common/packages_context.py` 与 `.trellis/scripts/common/config.py`：Trellis 已能标记 submodule 和独立 Git package，Skill 可以复用 package context。
- `vendor/skill-garden/.trellis/0.6/scripts/git_evidence.py:108-161`：已有多仓发现能力，但 worktree engine 当前未使用。
- `vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py:780-818`：`create` 只从来源读取开发者名字，并在目标新建空的 `.trellis/.runtime/sessions`；没有复制其它 gitignored 本地状态。
- `.agents/skills/trellis-route/scripts/route_state.py:142-158`：个人 route 默认固定存放在 `.trellis/.route-prefs.tmp`，内容只包含 `implement` / `check` 两个受限枚举。
- `.trellis/.gitignore:2-22`：`.developer`、`.current-task`、`.runtime/`、`.ralph-state.json`、agent/session 临时文件、`*.tmp`、备份和 Python cache 都不会随 `git worktree add` 检出。
- `.flower/.gitignore:1-6`：`.flower/state.json`、cache、transaction、控制态和 `*.tmp` 都是 worktree 本地状态，不会从来源工作区进入目标。
- 当前根仓还存在全局 ignore 的 `.claude/settings.local.json`；其中至少一条权限规则绑定来源根仓绝对路径，不能把整文件当作无条件可移植偏好。
- `git worktree add ... <base>` 只检出选定 commit。来源工作区的 tracked dirty 与 untracked 文件不会进入目标；排查时的实例曾包含 `.flower/plugins.json` / `plugin-lock.json` 修改、新增 GitLab Skill 投影和本任务目录，可直接证明这些内容不会随 base commit 进入目标。

## Local State Transfer Audit

| 状态 | 当前行为 | 建议分类 | 原因 |
| --- | --- | --- | --- |
| `.trellis/.developer` | 只继承名字并重建文件 | 继承 | 已有明确、受限契约，目标保留自己的初始化时间 |
| `.trellis/.route-prefs.tmp` | 丢失 | 继承候选 | 路径无关、枚举受限、属于同一开发者的长期个人偏好 |
| `.trellis/.runtime/sessions/*` | 新建空目录 | 禁止继承 | session、task、untracked 和 route runtime 都绑定旧会话 |
| `.trellis/.runtime/auto-loop/*` | 丢失 | 禁止继承 | run、队列、任务和授权绑定来源 worktree |
| `.trellis/.current-task` 与 Ralph/agent 临时态 | 丢失 | 禁止继承 | 目标会创建自己的 planning task，旧指针会造成跨 worktree 污染 |
| `.flower/update-check.tmp` 与 legacy cache | 丢失 | 新鲜重建 | 只是联网检查、提示和冷却缓存 |
| `.flower/cache/`、transactions、backup、pycache | 丢失 | 新鲜重建或忽略 | 可再生缓存或故障证据，不属于用户意图 |
| `.flower/state.json` | 丢失 | 不复制来源字节 | 包含本机 ownership、hash 和 Patch provenance，必须与目标 commit 的实际文件一致 |
| `.claude/settings.local.json` | 丢失 | 明确不继承 | 平台私有且可能含来源绝对路径或权限边界，本轮不读取、不复制 |
| 版本化 Trellis/平台/Flower 文件 | 从选定 commit 检出 | commit 继承 | 只应反映用户确认的 base commit，不应偷渡来源 dirty 内容 |
| 来源 tracked dirty / untracked 文件 | 丢失 | 预检披露 | 是否提交、stash 或排除是用户决策，create 不应暗中复制 |

## Resolved Product Decision

- 已确认采用严格白名单：`create` 为同一开发者继承合法 route 偏好；`prepare` 只有显式请求且来源同仓、同开发者时继承；其它平台/Flower 本机状态只披露、重建或忽略，不复制。
- `.claude/settings.local.json` 明确排除。它既不属于本轮用户价值，也可能包含来源绝对路径和权限边界。

## Design Implication

确认门禁必须位于写入事务之前，并由 machine-readable plan 支撑。CLI engine 负责 Git 事实和零写保证；Skill 负责把 plan 转成一次用户决策。harness 子仓只展示和分别确认，不进入根 worktree 的自动写入范围。

本地状态不能按目录复制。至少需要一份稳定的 transfer plan，明确哪些字段从来源继承、哪些在目标新建、哪些刻意不继承；来源 dirty 状态也必须成为确认信息的一部分，否则“从当前分支创建”容易被误解为“复制当前工作目录”。
