# 兼容 Trellis worktree 开发入口

## Goal

让用户在 linked Git worktree 中开发 Trellis 项目时，可以通过明确的 `trellis-worktree`
能力完成本地入口准备，使 `.trellis` runtime、`.agents/skills`、`.codex`、`.claude`
等已启用平台文件能被 AI 工具正常发现和执行；随后普通 task / untracked 流程应按既有
Trellis 规则继续运行。

当前问题不是单纯 untracked 状态读取失败，而是 linked worktree 通常没有未追踪的
`.trellis`、`.codex`、`.claude`、`.agents` 等目录。只在 hook 或
`untracked_flow.py` 中 fallback 到主 worktree，无法解决平台入口文件不存在导致 skill/hook
根本不加载的问题。

## Requirements

1. 新增 `trellis-worktree` skill，触发于用户明确提到 worktree、linked worktree、
   worktree 开发方式、或要求在 worktree 中准备 / 修复 Trellis 入口时。
2. `trellis-worktree` 只负责 worktree 准备和诊断，不接管普通 task、untracked、
   check、push 等后续流程；准备完成后回到现有 Trellis 工作流。
3. 新增受控 helper 脚本，用于在当前 linked worktree 中识别同一 Git 仓库里承载 `.trellis`
   的主 worktree。
4. helper 必须支持只读诊断模式，输出当前 worktree、主 worktree、缺失入口、冲突入口和计划动作。
5. helper 的准备模式必须只处理主 worktree 中已经存在的 Trellis / 平台入口目录或必要配置文件，
   至少覆盖 `.trellis`、`.agents`、`.codex`、`.claude`。
6. 准备模式默认使用 symlink 投影主 worktree 的入口；不支持 symlink 或用户环境限制时可以失败并给出
   明确诊断，不在 MVP 中自动退化为复制。
7. helper 必须幂等：重复运行不应重复写入、不应改变已正确投影的路径。
8. helper 必须 fail closed：当前路径不是 Git worktree、找不到带 `.trellis` 的主 worktree、
   或目标路径已有非本工具管理的文件 / 目录 / symlink 时，不覆盖、不删除用户内容。
9. helper 应记录本轮受管投影 manifest，便于后续诊断哪些路径由 `trellis-worktree` 创建。
10. 保留底层 fallback：已存在的 hook / `untracked_flow.py` 在 linked worktree 中运行时，
    可从同一 Git worktree 集合找回承载 `.trellis` 的主项目根；但这只是补强，不是主入口。
11. Skill-Garden 0.6 authoring 必须改 `vendor/skill-garden/.trellis/0.6/`，并同步
    `enhancements/0.6/` 快照；不得只改 dogfood 生成结果。

## Acceptance Criteria

- [ ] 当用户在 linked worktree 中提到 worktree 处理时，`trellis-worktree` skill 会触发并指导先运行诊断 / 准备脚本。
- [ ] 在一个主 worktree 有 `.trellis`、`.agents`、`.codex`、`.claude`，linked worktree 没有这些目录的测试场景中，准备脚本能创建对应 symlink。
- [ ] 准备脚本重复运行时输出已就绪，不产生额外修改。
- [ ] linked worktree 中已有非托管 `.codex` 或 `.claude` 时，准备脚本拒绝覆盖并报告冲突路径。
- [ ] 准备完成后，在 linked worktree 运行 hook 或 `untracked_flow.py status` 能解析到主 worktree 的 `.trellis` runtime。
- [ ] 现有普通 Trellis 项目、非 Git 目录、非 worktree 场景行为保持不变，不因新增逻辑误判为 worktree。
- [ ] `npm run sync` 后 `enhancements/0.6/` 包含新增 skill、helper、Patch 内容。
- [ ] 相关 Python 单测、Patch target check、语法检查和 `git diff --check` 通过。

## Out of Scope

- 不实现跨目录任务目标或跨目录 diff 所有权模型。
- 不改变普通 task / untracked / check / push 的阶段语义。
- 不自动复制平台目录作为 symlink 的 fallback。
- 不覆盖、迁移或合并 linked worktree 中已有的用户自定义 `.codex`、`.claude`、`.agents`。
- 不为所有可能平台一次性补齐完整私有规则；MVP 只投影主 worktree 已存在的入口路径。

## Confirmed Context

- `flower/skill-garden` 是当前项目已锁定插件，Skill-Garden 0.6 durable source 位于
  `vendor/skill-garden/.trellis/0.6/`，发布快照位于 `enhancements/0.6/`。
- 现有 `untracked_flow.py` 只从当前目录向上查找 `.trellis`，linked worktree 无 `.trellis`
  时会失败。
- 现有 `inject-workflow-state.py` hook 也依赖从当前 cwd 找 `.trellis`；如果 linked worktree
  没有 `.codex` / `.claude` 等平台目录，hook 本身不会被平台加载。
- 用户已确认方向：新增 `trellis-worktree` skill，使用户提到 worktree 处理时能正常准备
  `.claude`、`.codex` 等入口文件。
