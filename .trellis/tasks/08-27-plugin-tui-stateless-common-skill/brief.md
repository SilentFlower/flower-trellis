# Brief — Plugin TUI 无状态管理 common skill

## Goal

- 让 `flower-trellis plugin` 的交互管理器在目标项目没有 `.trellis/`、没有 `.flower/` 时，仍能用现有交互入口管理 Flower 随包发布的 common skill，且不把 common skill 写入 Plugin lock/state。

## Scope

- 调整 `src/lib/skill-catalog.js`，让 common skill catalog、安装和停用可在无 Trellis 项目中独立工作。
- 调整 `src/commands/skill.js`，复用现有 checkbox 菜单，在无 `.trellis/` 时只展示可管理 common skill。
- 调整 `src/commands/plugin-interactive.js`，让无 `.trellis/` 项目仍可通过现有内置入口进入 skill manager，同时避免调用完整 `flower/skill-garden` Runtime。
- 补充 no `.trellis`、no `.flower`、Codex/Claude 平台目录、legacy `.agents/skills`、安装、停用、迁移别名和 TUI action 的回归测试。

## Non-Goals

- 不把 common skill 伪装成普通可锁定 Plugin，也不为它写 `.flower/plugins.json`、`plugin-lock.json` 或 `state.json`。
- 不新增独立的 Plugin TUI 分区、模式选择页或用户可见的 common skill 概念解释。
- 不改变外部 Marketplace Plugin、远程来源、OAuth、capability approval 或 Patch Planner 语义。
- 不让无 Trellis 项目安装 `flower/skill-garden` 工作流强化包、Patch、hook 或 `.trellis/scripts`。
- 不新增远程下载；common skill 仍只来自当前 `flower-trellis` 包内快照。

## Key Decisions

- 用户交互不区分 common skill 与正式 Plugin；差异只存在于内部状态模型。
- common skill 的启用事实继续来自目标目录是否存在，不新增项目侧状态文件。
- 无 Trellis common-only 场景复用现有 `skill-manager` action 和 `flower-trellis skill` 菜单，不新增 TUI action 类型。
- Trellis 项目中的 `flower/skill-garden` 仍走完整 Plugin Runtime，保留 lock/state、Patch、事务和 shared common refresh。

## Key Context

- `installCommonSkills()` 已能无 `.flower` 安装 common skill，但 `listSkillCatalog()` 和 `removeCommonSkills()` 当前会被 `resolveEnhancementSnapshot()` 的 `.trellis/` 检查挡住。
- `buildBuiltinDiscoverEntries()` 当前在缺 `.trellis/` 时隐藏内置入口；无 Trellis 场景需要展示现有入口但不能调用 `SkillGardenBuiltinProvider.listCandidates()`。
- `handleAction()` 的 `skill-manager` 分支已经会打开现有 `flower-trellis skill` 菜单，可直接复用。
- `ProjectStore`、`TransactionWriter` 和 `PluginApplicationService` 的 `.flower` 生命周期契约保持不变，common-only 路径不得调用写入链。
- 任务证据见 `research/current-behavior.md`，实现/检查上下文已登记 CLI 输出、Plugin Runtime、Plugin Contracts 和模块规范。

## Risks / Deferred

- 无 `.trellis` 时展示 `flower/skill-garden` 内置入口可能让内部语义看起来像正式 Plugin；实现中必须确保该 action 只打开 skill manager，不执行 add/update/remove。
- 修改 `skill-catalog.js` 可能影响 builtin `skill-garden` 的 shared common refresh；需要用 `plugin-skill-garden.test.js` 回归验证。
- 本任务不新增非交互 `plugin add flower/<common-skill>` 之类 CLI 别名；如后续需要，应另行规划。

## Acceptance

- 临时目录仅包含 `.codex/` 时，Plugin TUI 能看到现有内置 Skill Garden 入口，进入后可勾选并安装 common skill。
- 安装后目标目录存在 `.codex/skills/<name>/SKILL.md`，且 `.flower/` 与 `.trellis/` 仍不存在。
- 无 `.trellis/` 时直接打开 `flower-trellis skill` 菜单，不再抛“目标不是 Trellis 项目(缺 .trellis/)”。
- 停用 common skill 只删除精确 common skill 目录，保留用户自建 skill，且不创建 `.flower/`。
- 已有 Trellis 项目中的 Plugin TUI 和 `flower/skill-garden` add/update 仍走完整 Runtime。
- 无 Trellis common-only 操作不会在问题页签记录 `.trellis` 缺失错误。
- 相关单测、受影响 JS `node --check` 和 `git diff --check` 通过。

## Next Step

- 用户确认本 brief 后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/08-27-plugin-tui-stateless-common-skill`，再进入实现阶段。
