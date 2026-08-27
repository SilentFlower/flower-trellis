# Plugin TUI 无状态管理 common skill - Design

## Architecture

现有系统分为两条不同状态模型：

- 正式 Plugin 生命周期：`ProjectStore` 读取和写入 `.flower/plugins.json`、`plugin-lock.json`、`state.json`，由 `PluginApplicationService`、`TransactionWriter` 和 Patch Planner 保障 lock、ownership、回滚和漂移检测。
- common skill 管理：`skill-catalog` 从 `enhancements/common/.common` 读取随包快照，按目标平台目录直接复制或删除 skill 目录，启用状态来自目标目录是否存在。

本任务保持这两条模型在内部清晰分离，但在用户交互上继续复用同一入口：Plugin TUI 中已有的内置 Skill Garden 条目仍是进入 common skill 勾选菜单的入口。无 `.trellis` 项目中，这个条目只代表“打开内置 skill 管理菜单”，不触发 `flower/skill-garden` Plugin 安装或解析。

## Data Flow

无 Trellis、无 `.flower` 项目：

```text
flower-trellis plugin
  -> runPluginInteractive()
  -> buildBuiltinDiscoverEntries()
  -> action: skill-manager
  -> openSkillManager()
  -> skill()
  -> listSkillCatalog()
  -> commonSkills from enhancements/common/.common
  -> installCommonSkills() / removeCommonSkills()
  -> .codex/skills 或 .claude/skills
```

已有 Trellis 项目：

```text
flower-trellis plugin
  -> runPluginInteractive()
  -> SkillGardenBuiltinProvider.listCandidates()
  -> action: skill-manager
  -> skill()
  -> common skill 勾选菜单

flower-trellis init/update 或显式 flower/skill-garden 生命周期
  -> PluginApplicationService
  -> projectSkillGardenContent()
  -> TransactionWriter
  -> .flower lock/state + Trellis 强化/patch/shared common refresh
```

## Contracts

- `listSkillCatalog(target, variantOverride)` 应在无 `.trellis` 时返回 common skill 清单，并把 `enhancementSkills` 置为空；只有需要展示工作流强化 skill 时才依赖 `resolveEnhancementSnapshot()`。
- `removeCommonSkills(target, variantOverride, names)` 不应为了删除 common skill 强制解析 Trellis 快照；删除安全性来自 `allCommonSkillDirs()`、当前 common snapshot 名称和精确目录约束。
- `buildBuiltinDiscoverEntries(context)` 在无 `.trellis` 时不得调用 `SkillGardenBuiltinProvider.listCandidates()`，避免把 common-only 场景升级为 `flower/skill-garden` Runtime。它可以用当前 Flower 版本展示原有内置入口。
- Plugin TUI 的 action 类型保持 `skill-manager`，不新增 `common-skill` action，不改变用户看到的页签模型。
- common-only 路径不得调用 `ProjectStore.write*()`、`TransactionWriter.apply()` 或 `runWithTrellisIntegrationEnabled()`。

## Compatibility

- 对没有 `.trellis` 的普通代码仓，`flower-trellis skill` 和 Plugin TUI 都能直接管理 common skill。
- 对已有 `.trellis` 的项目，`listSkillCatalog()` 仍展示 common skill 与工作流强化 skill；内置条目的版本仍来自 `SkillGardenBuiltinProvider` 的候选。
- 对已有 `.flower` 的项目，普通 Plugin list/update/remove/verify 行为不变。
- 对没有平台目录的项目，`installCommonSkills()` 继续使用现有 Claude fallback，不由本任务新增平台选择逻辑。

## Risks

- 风险：无 `.trellis` 时在 Plugin TUI 中展示 `flower/skill-garden` 可能让内部语义显得像正式 Plugin。控制：action 只打开现有 skill manager，不执行 add/update/remove。
- 风险：改 `listSkillCatalog()` 时误让工作流强化列表在无 Trellis 项目中显示。控制：无 `.trellis` 时 `enhancementSkills` 必须为空。
- 风险：删除 common skill 时误删用户自建同名目录。控制：沿用现有 common snapshot 名称、迁移和 tombstone 规则，不扩大扫描范围。

## Rollback

如果实现导致 Plugin TUI 或 Trellis 项目回归，可回退无 `.trellis` 分支逻辑。正式 Plugin Runtime、ProjectStore schema 和 TransactionWriter 不需要 schema 迁移。
