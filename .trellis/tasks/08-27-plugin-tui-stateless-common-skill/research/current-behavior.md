# Current Behavior Evidence

## common skill 独立路径

- `src/lib/skill-catalog.js` 的 `installCommonSkills(target, names)` 只读取 `enhancements/common/.common` 下的快照，并复制到 `.codex/skills/<name>`、`.claude/skills/<name>` 或 fallback 平台目录；该函数不导入 `ProjectStore`，不读写 `.flower`。
- `src/lib/skill-catalog.js` 的 `removeCommonSkills(target, variantOverride, names)` 当前会调用 `resolveEnhancementSnapshot(target, variantOverride)`，因此无 `.trellis` 项目中停用 common skill 会被 Trellis 快照解析挡住。
- `src/lib/skill-catalog.js` 的 `listSkillCatalog(target, variantOverride)` 当前先调用 `resolveEnhancementSnapshot()`，导致无 `.trellis` 项目无法打开 `flower-trellis skill` 菜单。

## `.trellis` 依赖点

- `src/lib/enhancement-catalog.js` 的 `resolveEnhancementSnapshot()` 在入口处检查 `.trellis/` 是否存在，缺失时抛出 `目标不是 Trellis 项目(缺 .trellis/)`。
- `src/builtin-plugins/skill-garden/provider.js` 的 `ensureSkillGardenReady()` 会调用 `resolveEnhancementSnapshot()`，因此 `SkillGardenBuiltinProvider.listCandidates("flower/skill-garden")` 不能用于无 Trellis common-only 场景。

## Plugin TUI 入口

- `src/commands/plugin-interactive.js` 的 `buildBuiltinDiscoverEntries()` 当前在目标缺少 `.trellis/` 时直接返回空列表，所以无 Trellis 项目中 Plugin TUI 不展示内置 Skill Garden 入口。
- 同文件中内置入口渲染为 `skill-manager` action；`handleAction()` 收到 `skill-manager` 后调用 `context.openSkillManager()`。
- `runPluginInteractive()` 的默认 `openSkillManager()` 会动态加载 `src/commands/skill.js` 并执行现有 `flower-trellis skill` 菜单。这个入口可以复用，不需要新增 TUI 分区或 action 类型。

## 正式 Plugin 生命周期

- `ProjectStore` 负责 `.flower/plugins.json`、`plugin-lock.json`、`state.json`；缺失 `plugins.json` 返回空声明，缺失 lock/state 返回 `null`。
- `TransactionWriter.apply()` 在真实写入时调用 `store.ensureLayout()` 并创建 `.flower/transactions/<id>`，随后按目标、plugins、lock、state 的顺序写入。
- `projectSkillGardenContent()` 在完整 `flower/skill-garden` 生命周期中调用 `describeInstalledCommonSkillSync()`，把已启用 common skill refresh 作为 shared ownership 记录进 state；卸载不删除 shared 路径。

## 既有产品决策

- 已归档任务 `.trellis/tasks/archive/2026-07/07-13-common-skill-auto-update/design.md` 明确：common skill 不新增项目侧状态文件，启用事实继续以目标路径是否存在为准，用户手工删除目录后更新不得重新安装。
- 本轮用户决策：Plugin TUI 交互不变，用户侧不区分 common skill 与 Plugin；内部可以区分状态模型，common skill 不写 `.flower`。
