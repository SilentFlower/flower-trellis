# Brief — 兼容 Trellis worktree 开发入口

## Goal

- 新增 `trellis-worktree` 能力和受控准备脚本，让用户在 linked Git worktree 中能正常使用主 worktree 的 `.trellis` runtime、共享 skill 和 `.codex` / `.claude` 等平台入口。

## Scope

- 新增 `trellis-worktree` skill，用户明确提到 worktree 处理时先进入该能力。
- 新增 `worktree_setup.py` helper，支持 `status` / `prepare` / `--target` / `--json`。
- helper 在当前 linked worktree 中识别同仓库里承载 `.trellis` 的主 worktree，并投影主 worktree 已存在的 `.trellis`、`.agents`、`.codex`、`.claude`。
- 默认使用 symlink，记录 manifest，重复运行保持幂等。
- 保留底层 fallback：hook / `untracked_flow.py` 已经能执行时，可从 Git worktree 集合找回主 `.trellis` 根。
- 以 `vendor/skill-garden/.trellis/0.6/` 为 authoring source，同步 `enhancements/0.6/` 快照。

## Non-Goals

- 不实现跨目录任务目标或跨目录 diff 所有权模型。
- 不改变普通 task / untracked / check / push 阶段语义。
- 不自动复制平台目录作为 symlink fallback。
- 不覆盖、迁移或合并 linked worktree 中已有的用户自定义 `.codex`、`.claude`、`.agents`。
- 不一次性扩到所有平台私有目录；MVP 只投影主 worktree 已存在的 `.trellis`、`.agents`、`.codex`、`.claude`。

## Key Decisions

- 主入口是 `trellis-worktree` skill + `worktree_setup.py`，不是只在 untracked 或 hook 里做 fallback，因为 linked worktree 缺平台目录时 hook/skill 根本不会加载。
- 准备模式默认 symlink 到主 worktree 的入口目录，避免复制后漂移。
- helper fail closed：已有非托管目标一律冲突拒绝，不覆盖用户文件。
- untracked state schema 不新增 worktree 绑定，避免扩大 direct-edit 流程语义。

## Key Context

- 当前项目由 `flower/skill-garden` 管理，durable source 在 `vendor/skill-garden/.trellis/0.6/`，发布快照在 `enhancements/0.6/`。
- Skill-Garden 0.6 hook/workflow/skill 修改必须走 Patch Engine 和同步流程，不能只改 dogfood 输出或 compiled target。
- 现有 `untracked_flow.py` 和 `inject-workflow-state.py` 都依赖当前 cwd 向上找到 `.trellis`，linked worktree 无 `.trellis` 时无法正常恢复上下文。
- 用户已确认新增 worktree 能力，用于正常处理 `.claude`、`.codex` 等平台入口文件。

## Risks / Deferred

- 需要严格测试已有用户平台目录的冲突拒绝，避免误覆盖 linked worktree 中的本地配置。
- helper manifest 放在 `<target-worktree>/.trellis-worktree.json`，不依赖目标已有 `.trellis`；后续如要支持清理命令，应基于该 manifest 单独设计。
- MVP 不支持自动复制 fallback；不支持 symlink 的环境会得到明确失败诊断。

## Acceptance

- linked worktree 提到 worktree 处理时，`trellis-worktree` skill 能指导先诊断 / 准备。
- 主 worktree 有 `.trellis`、`.agents`、`.codex`、`.claude` 且 linked worktree 缺失时，prepare 创建对应 symlink。
- prepare 重复运行保持 ready，不产生额外修改。
- linked worktree 已有非托管 `.codex` 或 `.claude` 时拒绝覆盖并报告冲突。
- 准备完成后，linked worktree 中 hook 或 `untracked_flow.py status` 能解析主 `.trellis` runtime。
- 普通 Trellis 项目、非 Git 目录、非 worktree 场景行为不变。
- `npm run sync` 后 `enhancements/0.6/` 包含新增 skill、helper、Patch 内容。
- 相关 Python 单测、Patch target check、语法检查和 `git diff --check` 通过。

## Next Step

- 用户确认 brief 后，运行 `task.py start` 进入实现，先补齐 `worktree_setup.py` 和 `trellis-worktree` skill，再整理当前 root fallback Patch。
