# Plugin TUI 无状态管理 common skill

## Goal

让 `flower-trellis plugin` 的交互管理器在目标项目没有 `.trellis/`、没有 `.flower/` 时，仍能用现有交互入口管理 Flower 随包发布的 common skill。用户不需要理解 common skill 与正式 Plugin 生命周期的差别；内部必须避免把 common skill 强行纳入 `.flower/plugins.json`、`plugin-lock.json` 或 `state.json`。

## Background

- common skill 本身是离线随包快照，来自 `enhancements/common/.common`，运行时不依赖 Trellis，也不需要 Flower Plugin lock/state。
- `installCommonSkills(target, names)` 已经能在只有 `.codex` 或 `.claude` 平台目录、没有 `.flower`、没有 `.trellis` 的项目中安装 common skill。
- 当前 `flower-trellis skill` 菜单通过 `listSkillCatalog()` 先调用 `resolveEnhancementSnapshot()`，后者硬要求 `.trellis/` 存在，导致无 Trellis 项目无法打开菜单。
- 当前 Plugin TUI 的发现页只有目标存在 `.trellis/` 时才展示内置 `flower/skill-garden` 入口；选中后会打开现有 `flower-trellis skill` 菜单。
- `flower/skill-garden` 正式 Plugin 生命周期仍然用于 Trellis 工作流强化、Patch、lock/state、shared common refresh 和卸载安全，不应被 common-only 场景削弱。

## Requirements

- R1：`flower-trellis plugin` TUI 在无 `.trellis/`、无 `.flower/` 的项目中可以打开，并以现有内置入口进入 common skill 管理，不新增单独的 common skill 分区或额外概念。
- R2：用户交互保持现有模型：仍使用 Plugin 管理器的已有发现/已安装/来源/问题页签，以及现有 `flower-trellis skill` 勾选菜单；不要求用户选择“正式 Plugin”或“common skill”模式。
- R3：无 Trellis 项目中的 skill 菜单只展示可管理 common skill；工作流强化 skill 只读列表因缺少 `.trellis` 证据而自然为空，不抛“目标不是 Trellis 项目”错误。
- R4：在无 `.flower` 项目中启用或停用 common skill 时，只改对应平台 skill 目录，例如 `.codex/skills/<name>`、`.claude/skills/<name>` 或历史 `.agents/skills/<name>`，不得创建 `.flower/`、`.trellis/`、Plugin lock/state 或 trellis-control 状态。
- R5：已存在 Trellis 项目的行为保持兼容：`flower/skill-garden` 仍按完整 Plugin Runtime 管理工作流强化、Patch、事务、lock/state 和 shared common refresh。
- R6：common skill 的安装状态继续以目标目录是否存在为准；手工删除目录后不会被 TUI 或普通更新重新安装，除非用户再次勾选启用。
- R7：common skill 的迁移和 tombstone 语义保持现有契约：旧名称作为安装别名，迁移先写新 Skill 再删除旧目录；无效迁移声明必须 fail closed，不误删旧能力。
- R8：错误和输出遵守现有 CLI/TUI 约定：交互使用 `@inquirer/prompts`，非 TTY 不等待输入，慢操作先给中文进度，错误进入问题页签或顶层统一错误处理。

## Acceptance Criteria

- [ ] AC1：临时目录仅包含 `.codex/` 时，运行 Plugin TUI 能看到现有内置 Skill Garden 入口，进入后可勾选并安装一个 common skill。
- [ ] AC2：AC1 完成后目标目录存在 `.codex/skills/<name>/SKILL.md`，且 `.flower/` 与 `.trellis/` 仍不存在。
- [ ] AC3：临时目录没有 `.trellis/` 时直接打开 `flower-trellis skill` 菜单，不再因为 `resolveEnhancementSnapshot()` 抛错；菜单能列出 common skill，工作流强化列表为空或不展示。
- [ ] AC4：取消勾选已安装 common skill 后只删除精确 common skill 目录，保留同一 skill root 下的用户自建 skill，且不创建 `.flower/`。
- [ ] AC5：已有 Trellis 项目中的 Plugin TUI 和 `flower/skill-garden` add/update 仍走完整 Plugin Runtime，继续写入并校验 `.flower/plugins.json`、`plugin-lock.json` 和 `state.json`。
- [ ] AC6：无 Trellis 项目中选择 common skill 管理不会在问题页签记录“目标不是 Trellis 项目(缺 .trellis/)”。
- [ ] AC7：相关单测覆盖 no `.trellis`、no `.flower`、Codex/Claude 平台目录、legacy `.agents/skills`、安装、停用、迁移别名和 TUI action。
- [ ] AC8：受影响 JS 文件通过 `node --check`，相关 Node.js 测试通过，最终 `git diff --check` 通过。

## Out Of Scope

- 不把 common skill 伪装成普通可锁定 Plugin，也不为它写 `.flower/plugins.json`、`plugin-lock.json` 或 `state.json`。
- 不新增独立的 Plugin TUI 分区、模式选择页或用户可见的 common skill 概念解释。
- 不改变外部 Marketplace Plugin、远程来源、OAuth、capability approval 或 Patch Planner 语义。
- 不让无 Trellis 项目安装 `flower/skill-garden` 工作流强化包、Patch、hook 或 `.trellis/scripts`。
- 不新增远程下载；common skill 仍只来自当前 `flower-trellis` 包内快照。

## Technical Notes

- 主要候选改动点：
  - `src/lib/skill-catalog.js`：让 common skill catalog 可在无 `.trellis` 时独立加载，并让停用 common skill 不依赖 `resolveEnhancementSnapshot()`。
  - `src/commands/skill.js`：复用现有菜单，处理无 Trellis catalog 的页头与空强化列表。
  - `src/commands/plugin-interactive.js`：无 `.trellis` 时仍可暴露现有内置入口并打开 skill manager，同时不调用会要求 Trellis 快照的 `SkillGardenBuiltinProvider.listCandidates()`。
  - `test/js/aliyun-ops-skill.test.js`、`test/js/plugin-interactive.test.js` 或邻近测试：补交互与 no-state 回归。
- 需要保留的现有契约：
  - `installCommonSkills()` / `removeCommonSkills()` 只处理固定 common skill 根中的精确目录。
  - `flower/skill-garden` 正式 Plugin 在 Trellis 项目中仍记录 shared common ownership，卸载不删除 shared 路径。
  - 缺失 `.flower/plugins.json` 仍表示空 Plugin 声明；损坏 `.flower` 状态不能被 common-only 路径覆盖。
