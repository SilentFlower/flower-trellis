# 兼容 Trellis worktree 开发入口 - Design

## Architecture

新增能力分三层：

1. Skill 入口：`trellis-worktree` 负责触发、诊断顺序、安全边界和后续流程交还。
2. Helper 脚本：`worktree_setup.py` 负责可重复、可审计地把主 worktree 的 Trellis / 平台入口投影到当前 linked worktree。
3. Runtime fallback：`untracked_flow.py` 和 `inject-workflow-state.py` 在脚本已能运行时，从 Git worktree 集合找回承载 `.trellis` 的主项目根。

Skill 入口解决“AI 会不会先处理 worktree 准备”的问题；helper 解决“平台入口文件是否存在”的问题；fallback 解决“入口已存在但 cwd 不在主 `.trellis` 树下”的问题。

## Ownership And Source

- Skill-Garden 0.6 源：`vendor/skill-garden/.trellis/0.6/`
- 发布快照：`enhancements/0.6/`
- Hook 修改：通过 `overrides/patches/hooks/inject-workflow-state/shared-runtime/patch.json`
  声明 Patch operation，不直接编辑 compiled target。
- 新 skill 同步写入 `.agents/skills/trellis-worktree/SKILL.md` 和
  `.claude/skills/trellis-worktree/SKILL.md`，保持 Codex / Claude 共享能力一致。

## Helper Contract

建议脚本路径：

```text
.trellis/0.6/scripts/worktree_setup.py
```

安装后路径：

```text
.trellis/scripts/worktree_setup.py
```

CLI：

```bash
python3 ./.trellis/scripts/worktree_setup.py status
python3 ./.trellis/scripts/worktree_setup.py prepare
```

当 linked worktree 没有 `.trellis` 时，用户无法通过相对路径运行该脚本。skill 应指导优先从主
worktree 运行：

```bash
python3 <main-worktree>/.trellis/scripts/worktree_setup.py prepare --target <linked-worktree>
```

脚本参数：

- `status`：只读输出 JSON，不写盘。
- `prepare`：创建缺失入口 symlink。
- `--target <path>`：显式指定待准备 linked worktree；默认当前目录。
- `--json`：稳定 JSON 输出，便于测试和未来 hook 调用。

## Project Root Resolution

解析顺序：

1. 从 target 向上找 `.trellis`，若存在，说明当前目录已经是 Trellis 根或其子目录。
2. 运行 `git -C <target> rev-parse --path-format=absolute --git-common-dir`，取 common dir 的父目录作为主 worktree 候选。
3. 运行 `git -C <target> worktree list --porcelain`，寻找第一个存在 `.trellis` 的 worktree。
4. 任一步失败都返回结构化 reason，不猜测、不写盘。

## Projection Paths

MVP 投影主 worktree 已存在的路径：

- `.trellis`
- `.agents`
- `.codex`
- `.claude`

后续可把其它平台路径加到同一常量表，但不在本任务中扩大到全平台。

## Safety Rules

- 目标路径缺失：创建 symlink。
- 目标路径已是指向同一源的 symlink：视为 ready。
- 目标路径存在且非本 helper manifest 管理：冲突并拒绝。
- 目标路径是损坏 symlink：只有 manifest 证明由本 helper 创建时才可修复。
- 不删除普通文件 / 目录。
- 不穿越目标 worktree 根；拒绝绝对路径以外的不可信内部拼接。

Manifest 建议路径：

```text
<target-worktree>/.trellis-worktree.json
```

它不依赖 `.trellis` 存在，记录 schemaVersion、sourceRoot、targetRoot、links[] 和 updatedAt。

## Hook / Untracked Fallback

`untracked_flow.py`：

- 将 `_find_repo_root()` 扩展为当前目录 upward、Git worktree fallback、脚本所在根 fallback。
- 不把 untracked state 绑定到具体 worktree，避免扩大流程语义。

`inject-workflow-state.py` Patch：

- 替换 `find_trellis_root()`，在当前 cwd 无 `.trellis` 时通过 Git worktree fallback 找主根。
- 该 fallback 只在 hook 文件已经存在并执行时生效。

## Validation Plan

- `test_untracked_flow.py`：覆盖 linked worktree cwd 无 `.trellis` 时 helper CLI 能找到主根 runtime。
- `test_workflow_state_hook.py`：覆盖 hook 从 linked worktree cwd 加载主 `.trellis/workflow.md` 和 untracked runtime。
- 新增 `test_worktree_setup.py`：覆盖 status、prepare、幂等、冲突拒绝。
- `npm run sync` 后检查 `enhancements/0.6` 快照包含新增源。
- Python 语法检查、相关 unittest、`npm run patch:targets:check`、`git diff --check`。
