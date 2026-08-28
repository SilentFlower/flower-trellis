# Flower Plugin Runtime And Lifecycle

> 本规范定义 Flower Plugin v1 的 Source Registry、依赖解析、多平台内容投影、统一安装计划、事务写入和项目级生命周期 CLI。公共 DTO、schema、摘要与 `.flower/` 文件格式以 [Flower Plugin Contracts](./flower-plugin-contracts.md) 为唯一来源。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/application-service.js`、`resolver/**`、builtin/local Source Provider、`install/**` 或 `src/commands/plugin.js` 的生命周期路径。
- 改变 `plugin list/add/update/remove/verify` 参数、退出码、JSON 输出、平台检测、锁定优先、依赖求解、目标 ownership 或事务恢复语义。
- 为 GitLab、GitHub、外部格式 Adapter、Patch capability、内置 Plugin 或作者工具接入基础 Runtime。

P2 Runtime 只负责项目级解析、计划和写盘。远程认证与候选准备、Patch 授权、旧增强迁移必须通过可选模块或进程内扩展点接入，不能把 P3/P4/P5 实现静态并入基础生命周期模块。

## 2. Signatures

```js
new SourceRegistry(providers?)
SourceRegistry.register(provider) -> SourceRegistry
SourceRegistry.has(sourceId) -> boolean
SourceRegistry.get(sourceId) -> SourceProvider
SourceRegistry.listCandidates(canonicalId) -> PluginCandidate[]
SourceRegistry.readPackage(plugin) -> { root, manifest, integrity }

new BuiltinSourceProvider({ id, root, referencePrefix? })
new LocalSourceProvider({ id, projectRoot, references })

resolvePluginGraph(declarations, registry, {
  lockedPlugins?,
  update?,
  grantCapabilities?,
}?) -> { graph, selected, orphans, constraints }
buildPluginLock(graph) -> PluginLock

listPluginPlatforms() -> string[]
detectPluginPlatforms(projectRoot, explicitPlatforms?)
  -> { platforms, targets: Array<{ root, source, platforms }> }
resolveSkillGardenPlatforms(projectRoot) -> string[]
projectPluginContent(options) -> ContentProjection
createInstallPlan(graph, mutations, options) -> InstallPlan

new TransactionWriter(projectRoot, options)
TransactionWriter.apply(input) -> TransactionResult

new PluginApplicationService(projectRoot, { registry, store?, writer?, platformDetector? })
PluginApplicationService.list() -> { plugins, lock, state }
PluginApplicationService.add(options) -> LifecycleResult
PluginApplicationService.update({
  id?,          // 单个 Plugin；与 widen 互斥
  version?,     // SemVer range，必须与 id 同时给出
  widen?,       // Map<canonicalId, range> 或等价对象；命中时按 update="all" 解析
  platforms?, dryRun?, approvals?, approvedDigests?, nonInteractive?, onPreflight?,
}?) -> LifecycleResult
PluginApplicationService.replay(options?) -> LifecycleResult
PluginApplicationService.remove(options) -> LifecycleResult
PluginApplicationService.verify(options?) -> { ok, diagnostics }

parsePluginArgs(argv) -> PluginCommand
plugin(ctx, options?) -> Promise<0 | 1 | 2 | 3>
```

Common skill 管理入口固定为：

```js
listSkillCatalog(target, variantOverride?)
  -> { variant, version, commonSkills, enhancementSkills }
installCommonSkills(target, names)
  -> { installed, paths, skipped }
removeCommonSkills(target, variantOverride, names)
  -> { removed, skipped }
```

`plugin update` 的命令行签名：

```text
flower-trellis plugin update [plugin] [--version <range>] [--widen <plugin>=<range>]... \
  [--platform <id>] [--dry-run] [--json]
```

```js
new PluginFormatRegistry(adapters?)
PluginFormatRegistry.detect(snapshotRoot, { format? }?) -> DetectionResult[]
PluginFormatRegistry.selectSingle(detections) -> DetectionResult
PluginFormatRegistry.normalize(selection, context) -> NormalizedPlugin
```

Source Provider 最小接口固定为：

```js
{
  id: string,
  type: string,
  listCandidates(canonicalId) -> PluginCandidate[],
  readPackage(plugin) -> { root, manifest, integrity },
}
```

远程 Provider 可额外实现异步 `prepare(canonicalId)`、`prepareLocked(plugin)` 和 `search(query)`，但这些方法由 P3 适配层调用，不进入 P2 `SourceRegistry` 的最小接口。

## 3. Contracts

### Source And Resolver

- `SourceRegistry` 按唯一 source ID 注册 Provider；重复 ID、缺失最小方法或 canonical ID 与候选身份不一致必须在进入 Resolver 前失败。
- builtin/local Provider 都通过 P1 package reader 校验 manifest、包根边界和 canonical tree hash。local reference 必须位于项目内，不能因开发用途放宽安全校验。
- Resolver 以 canonical Plugin ID 为唯一节点键，递归收集直接和传递依赖约束，并输出依赖优先的稳定拓扑。
- 普通重放优先选择仍满足约束且摘要未漂移的旧 lock 候选；只有 `update` 指定的节点或 `update="all"` 才允许选择更高兼容版本。
- `update({id,version})` 必须先把该直接声明改为请求的精确约束，再进入解析；未指定 ID 时禁止携带 version。builtin skill-garden 更新必须用当前 Flower 包版本刷新直接声明，不能只更新 Provider 候选而留下旧约束。
- 用法校验先于空项目短路：`version` 缺 `id`、`widen` 与 `id` 并用、`widen` 指向未声明 Plugin 都必须抛 `PLUGIN_USAGE_ERROR`，不得因项目零声明而静默返回 `unchanged`。
- **锁定包不可重放是可达状态，不是异常**。Marketplace 只保留最新版时（rd-guide 即此策略），旧的精确锁既筛不到候选，其锁定包也已消失。此时未列入 `update` 的节点走 lock-first 会抛 `PLUGIN_TARGET_DRIFT`（`已锁定 Plugin 包不可重放`），于是「只更新 A」被 B 挡住、「只更新 B」又被 A 挡住，形成互锁。
- `update({widen})` 是解开该互锁的唯一入口：把全部越界声明一次性改写为请求的 range，并按 `update="all"` 解析，使每个节点都 `allowUpdate=true`，绕开 lock-first 抛错。调用方不得逐个 `update({id,version})` 循环放宽——第一条命令就会失败。
- `widen` 只改写覆盖表中列出的声明；未越界的声明保持原样，不因整图放宽而被顺带升级约束。
- `widen` 的每个 range 必须是合法 SemVer range，每个 key 必须是当前 `plugins.json` 中已声明的 canonical ID。
- CLI `--widen <plugin>=<range>` 可重复，按**第一个** `=` 切分。range 自身含 `=`（如 `>=0.2.2 <0.3.0`）时落在右侧，不受影响；不得改用重复 `--version` 承载 `id=range`，裸 range 与 `id=range` 两种形态无法安全区分。
- CLI `--content-skill <name>` 可重复，也允许逗号列表；归一化后写入直接声明 `contentSelection.skills`。该参数只允许 `plugin add` 和带单个 Plugin ID 的 `plugin update`，不得与 `--widen` 并用。Resolver 只把直接声明的选择带入对应 root，依赖始终安装 manifest 声明的完整 Skill 内容。
- Content projector 只用 `contentSelection.skills` 过滤 manifest `content.skills`；`specs/assets/scripts/tests` 仍按 manifest 全量投影为普通被动内容。过滤匹配使用每个 Skill entry 的 POSIX basename，并在 basename 重复或选择不存在时失败。
- 候选、约束、roots、orphans 和 lock 输出必须按 UTF-8 稳定排序，不能依赖 Provider、对象或文件系统返回顺序。

### Platform And Install Plan

- 平台名单只从 `ENHANCEMENT_SKILL_TARGETS` 派生。显式 `--platform` 必须全部合法；未显式选择时
  按每个逻辑平台的原生检测路径判断。共享物理 Skill root 只用于 target 去重，不能把全部消费者
  视为已启用，也不能让 Plugin 自己生成的平台文件成为下一次检测证据。
- 生命周期平台优先级固定为“本轮显式选择 -> 既有 Plugin state 实际平台 -> 首次安装自动检测”。
  update/replay/remove 不得依赖受管 Skill 目录反推平台；否则共享 root 收窄后会让已安装 Plugin
  无法更新或删除。Skill-Garden wrapper 可以显式传入重新检测结果，用于纠正旧的错误 state。
- `resolveSkillGardenPlatforms(projectRoot)` 是 Skill-Garden wrapper 的平台事实入口：优先使用
  Trellis `getConfiguredPlatforms()` 从 `.trellis/.template-hashes.json` 推导当前模板配置，并将
  `claude-code` 映射为 Plugin 平台 `claude`；只有缺少 hash 证据或读取失败时，才回退到
  `detectPluginPlatforms()` 的原生检测和 Claude compatibility fallback。不得让既有
  `.flower/state.json` 的污染平台列表成为 Skill-Garden update 的默认事实源。
- 完全没有可用平台时返回 `PLUGIN_PLATFORM_SELECTION_REQUIRED`，不得沿用增强链的 Claude fallback，也不得创建 `.trellis/` 或安装 `skill-garden`。
- 多个逻辑平台共享同一物理 root 时只生成一个 mutation，并在 provenance 中保留全部逻辑平台。
- `createInstallPlan()` 在写盘前统一检查安全相对路径、父路径软链、同目标多 owner/内容、文件目录前缀、现有用户文件和 state ownership。
- 普通内容与后续 Patch mutation 必须进入同一个 `InstallPlan`；不能建立第二套 writer 或依赖写入顺序解决冲突。

### Transaction And Lifecycle

- 所有目标、声明、lock 和 state 在任何写入前完成解析、包摘要、平台、payload 和冲突 preflight。
- `TransactionWriter` 写前复核 target/directory before hash 和 payload after hash；任一漂移时不得创建成功 state。
- 安装态目录摘要与包来源 `integrity` 是两套口径：包摘要走严格 canonical tree，任何多余文件都改变摘要；
  受管目录的 ownership / drift 判定必须忽略解释器就地生成的 `__pycache__` 与 `.pyc`，否则执行过受管
  Python 脚本的项目会被误判为「目录已被用户修改」，硬阻断 replay、update 与 Trellis enable。
  既然摘要忽略这类产物，`directoryRemovals` 删除受管目录前也必须先清掉它们，避免非递归 `rmdir` 报 `ENOTEMPTY`。
- 写入顺序固定为目标 mutation、`plugins.json`、`plugin-lock.json`、最后 `state.json`。失败时逆序恢复；恢复不完整时保留 `.flower/transactions/<id>/` 证据并返回 repair blocker。
- `dryRun` 返回同一 graph、plan、changes 和 diagnostics，但不创建 `.flower/`、事务目录或目标文件。
- changed-only：before/after hash 相同的目标不重写；空项目 `plugin update` 返回 `unchanged`，且不初始化 Runtime。
- `remove` 只删除 state 中归属当前 Plugin 且当前 hash 仍匹配的路径，并只清理不再从 roots 可达的传递依赖。单个路径冲突不得阻止其它 hash-clean exclusive 路径清理；冲突、shared 和仍被其它 owner 使用的证据继续保留在 state。
- `verify` 只读检查声明、lock roots/可达性、固定包、state ownership、版本和目标 hash，不更新 Provider、不修复文件。
- 项目存在合法 `.flower/trellis-control.json` 且状态为 `disabled` 时，真实
  `plugin add/update/remove/replay` 必须通过 `runWithTrellisIntegrationEnabled()` 临时恢复 Trellis
  入口，执行原 Plugin 事务后再按最新 ownership 重新 detach。最终状态必须仍为 `disabled`；
  外部 Plugin 的声明、lock、state 和目标内容必须保留。
- disabled 包装只作用于会修改项目的生命周期命令。`list`、`verify`、source/auth/search、作者工具和
  所有 `dryRun` 继续遵守原只读边界，不得为了检查而 materialize Trellis 入口。
- Plugin 事务或重新 detach 任一步失败时，外层 update snapshot 必须恢复调用前完整 disabled 现场；
  恢复不完整升级为 Trellis control `repair-required`，不能输出 Plugin 成功后留下可发现入口。

### Optional Runtime Boundaries

- `src/commands/plugin.js` 可以通过 `import()` 按需加载 `plugin-remote.js` 和 Patch planner；基础模块不得静态导入 GitLab/GitHub 网络客户端、OAuth、用户 source store 或 capability planner。
- 远程模块只负责管理命令、Provider 登记和异步候选准备；最终依赖解析、计划、事务和输出结果仍由 P2 Application Service 完成。
- 远程 Provider 只负责把 branch/tag/default branch 解析为不可变 commit、下载安全快照和准备候选；格式 Adapter 只负责检测、兼容性分析与规范化，二者不得相互复制来源或写盘逻辑。
- 自动检测必须返回全部稳定排序的有效入口。零候选返回 `PLUGIN_FORMAT_UNRECOGNIZED`；多个候选返回带 `detections[]` 的 `PLUGIN_SOURCE_AMBIGUOUS`。交互管理器必须让用户选择并用固定 `format/entryPath` 重试，非交互模式不得猜测。
- Claude Code、Codex 与 skill-only 内容只能先规范化为标准 Flower package。首版只导入 Skills 和可转换的 Claude commands；hooks、MCP、LSP、bin、settings、apps 等仅进入兼容报告，不复制到可执行位置，也不运行。
- 来源新增/更新的兼容预览使用操作系统临时目录中的独立 cache root，并在成功或失败后清理。确认前、取消和探测失败不得创建项目 `.flower/cache` 或写用户 source store。
- 进程内扩展注册必须与模块加载顺序无关：扩展实现晚于基础对象加载时，需要回补此前等待的实例或请求，不能静默丢失。
- 自定义内容投影只允许持有进程内 builtin 信任标记的 Provider 实现。外部 Provider 即使伪造 `type=builtin`、同名 source 或序列化字段，也不得取得 `projectContent()`、多 system catalog、adapter 或 unowned takeover 权限。
- system 投影可以为迁移声明 `allowUnownedWrite` / `allowUnownedRemove`，但这些标记只能由可信自定义投影产生；普通 Plugin 仍必须遵守既有 state ownership。
- `replay({ preserveIds })` 用于冻结已锁定节点：被冻结节点必须复用旧 lock 的 version/source/commit/integrity、精确 dependencies、compatibility、capability profile/grant 和旧 state，不能从当前随包 manifest 重算约束或生成 mutation；其余节点仍走完整 lock-first 解析、校验和事务。

### Builtin Skill-Garden

- `flower/skill-garden` 是显式 builtin system Plugin。完整 `init` 默认声明它；独立 `plugin add` 不得隐式声明。
- 目标缺少 `.trellis/` 时，`flower-trellis plugin` 仍可在发现页展示 `flower/skill-garden`
  入口，但该入口只能生成既有 `skill-manager` action 并打开 `flower-trellis skill` 菜单；
  不得调用 `SkillGardenBuiltinProvider.listCandidates()`、`PluginApplicationService`、
  `TransactionWriter.apply()` 或 `runWithTrellisIntegrationEnabled()`，也不得创建 `.flower/`、
  `.trellis/`、lock/state 或 trellis-control 状态。入口版本用当前 `flowerVersion()` 展示。
- `listSkillCatalog(target, variantOverride)` 在目标缺少 `.trellis/` 时只读取随包
  `enhancements/common/.common`，返回 common skill 清单与空 `enhancementSkills`；只有目标已有
  `.trellis/`、需要展示工作流强化 skill 时，才调用 `resolveEnhancementSnapshot()`。
- `removeCommonSkills(target, variantOverride, names)` 的删除安全性来自当前 common snapshot 名称、
  迁移/tombstone 规则和 `allCommonSkillDirs()` 精确目标约束；目标缺少 `.trellis/` 时不得为了停用
  common skill 强制解析增强快照。
- Provider digest 稳定绑定 Flower 版本、variant、去除 `syncedAt` 的快照 manifest，以及当前 variant、`enhancements/common`、`src/assets`、`src/lib`、`src/patches` 和 builtin Plugin 目录的 canonical 内容；不得包含绝对路径、mtime、同步时间、`__pycache__` 或 `.pyc`。
- skill-garden 的内容投影必须和 digest 同口径忽略 `__pycache__` / `.pyc`。发布包靠 `package.json`
  的 `files` 排除它们，源码检出(开发树、`npm link`)没有这层保护；一旦把源码树的字节码缓存投影出去，
  就会写进目标项目并登记进 state，使该项目的安装态只有那棵源码树能重放。
- 0.6 的 skill-garden/flower catalog 必须进入同一个 Patch preflight；内容与 Patch 同目标仅在同 owner、可信 system 且最终 hash 完全相同时合并，否则按内容冲突失败。
- old/0.5 后处理必须在临时镜像中计算最终字节，再作为普通 mutation 进入事务；不得直接对目标调用 legacy 写函数。
- common skill 刷新记录为 `shared` ownership，Plugin 更新可刷新，卸载和 orphan 清理不得删除。
- 0.6 Check-All agent 投影按本轮 `platformSelection.platforms` 收敛；旧 state 中不再启用的平台
  agent 必须从新 state 删除，并由普通 removal mutation 清理文件。父目录只在当前目录全部普通文件
  都是本轮确认淘汰的旧受管文件时才登记 `directoryRemovals`，避免删除用户自有 `.gemini`、`.zcode`
  或其它平台目录内容。
- `--no-enhance` 更新使用冻结 replay：skill-garden lock/state 原样保留，外部 Plugin 仍按固定 lock 重放，且不允许升级未显式请求的外部版本。
- `flower-trellis uninstall` 必须在调用 Trellis 前检查 lock 中的反向依赖；仍有外部 Plugin 依赖 `flower/skill-garden` 时整次卸载失败关闭，Trellis 与 Plugin 目标均不得写入。

## 4. Validation & Error Matrix

| 条件 | 错误 / 结果 | 写入边界 |
| --- | --- | --- |
| Provider 缺少接口或 source 重复 | `TypeError` / `PLUGIN_SOURCE_DUPLICATE` | Resolver 未运行 |
| source 未注册或候选来源歧义 | `PLUGIN_SOURCE_NOT_FOUND` / `PLUGIN_SOURCE_AMBIGUOUS` | 零写入 |
| 仓库没有受支持入口或外部内容不可安全导入 | `PLUGIN_FORMAT_UNRECOGNIZED` / `PLUGIN_FORMAT_UNSUPPORTED` | source store、`.flower/` 与目标文件零写入 |
| 依赖缺失、约束冲突、自依赖或循环 | `PLUGIN_DEPENDENCY_MISSING` / `PLUGIN_DEPENDENCY_CONFLICT` / `PLUGIN_DEPENDENCY_CYCLE` | 零写入，details 保留稳定约束或 cycle |
| 精确锁声明越界且锁定包已从来源消失，节点未列入 `update` | `PLUGIN_TARGET_DRIFT`（`已锁定 Plugin 包不可重放`） | 零写入；须改用 `update({widen})` 一次覆盖全部越界声明 |
| `version` 缺 `id` / `widen` 与 `id` 并用 / `widen` 指向未声明 Plugin | `PLUGIN_USAGE_ERROR`，退出码 `2` | 零写入，空项目也不得降级为 `unchanged` |
| `--widen` 取值不是 `<plugin>=<range>`、range 非法或同一 Plugin 重复声明 | `PLUGIN_USAGE_ERROR`，退出码 `2` | 参数解析阶段失败，Runtime 未启动 |
| 平台未知或未选择 | `PLUGIN_PLATFORM_UNKNOWN` / `PLUGIN_PLATFORM_SELECTION_REQUIRED` | 不创建 `.flower/` 和平台 root |
| 目标缺少 `.trellis/` 且打开 Plugin TUI | 展示 `flower/skill-garden` skill-manager 入口 | 不调用 builtin Provider 候选解析，不创建 `.flower/` 或 `.trellis/` |
| 目标缺少 `.trellis/` 且打开 `flower-trellis skill` | common skill 可管理，工作流强化列表为空 | 不抛 `目标不是 Trellis 项目`，不写 Plugin state |
| 目标缺少 `.trellis/` 且停用 common skill | 只删除当前 common snapshot 声明的精确 skill 目录 | 保留用户自建同 root skill，不创建 `.flower/` |
| 同目标 ownership/内容或前缀冲突 | `PLUGIN_CONTENT_CONFLICT` | 事务目录尚未创建 |
| 计划后 target、directory 或 payload 漂移 | `PLUGIN_TARGET_DRIFT` | project files 不写入 |
| 事务中途失败且恢复成功 | `PLUGIN_TRANSACTION_FAILED` | 目标和三类 project files 恢复 |
| 恢复或事务清理不完整 | `PLUGIN_TRANSACTION_REPAIR_REQUIRED` | 保留事务证据，不写成功 state |
| CLI 参数错误 | 退出码 `2` | JSON diagnostics 不含绝对路径 |
| 验证或内容冲突 | 退出码 `3` | 零写入或只读 verify |
| 其它执行失败 | 退出码 `1` | 按事务边界恢复 |
| disabled 项目执行真实 mutating lifecycle | 临时 materialize，操作后重新 detach | 外部 Plugin 内容保留，最终 `status=disabled` |
| disabled 包装失败且补偿成功 | 返回原失败 | 恢复调用前 disabled 现场 |
| disabled 包装补偿不完整 | Trellis control repair blocker | 持久化 `repair-required` 并保留项目外补偿 manifest |

- disabled 包装的外层快照必须在 Plugin `onPreflight` 后按 `contentMutations` 与 `patchMutations` 的
  精确 target 扩展。普通 Update 快照仍排除 tasks/spec/workspace 用户数据；只有 Plugin 明确计划触达的
  文件或首个缺失祖先进入 forced scope，回滚不得借此扫描或覆盖整个用户数据目录。

## 5. Good / Base / Bad Cases

### Good

- 项目显式选择 `codex`，安装 `local/demo` 及其共享依赖；共享 `.agents/skills` 只产生一个目标 mutation，lock 使用稳定依赖优先顺序。
- 项目已有 lock 且约束未变：普通 add/remove 重算仍保持兼容旧版本；显式 update 才升级目标节点。
- `flower-trellis update` 遇到旧 Skill-Garden state 含 `gemini/zcode`，但 Trellis 模板 hash 只记录
  `claude-code/codex` 时，wrapper 显式传入 `claude/codex`，新 state 收窄到真实平台，且只清理纯旧
  check-all agent 目录。
- P3 动态加载远程适配器、准备 GitLab Provider 后，把同一 `SourceRegistry` 交给 Application Service，远程包与 local/builtin 包走相同 Resolver 和事务。
- Marketplace 只保留最新版且三个精确锁中有两个越界：一次 `update --widen a=^0.4.0 --widen b=^0.2.2` 即完成放宽与更新；未越界的第三个声明保持原样，lock 同步到两个新版本。

### Base

- 空项目执行 `plugin list` 或无参数 `plugin update`：返回空视图或 `unchanged`，不创建 `.flower/`。
- 普通代码仓只有 `.codex/` 或 `.claude/`，没有 `.trellis/`、`.flower/`：交互式 `plugin`
  首页可显示 `flower/skill-garden` 入口并零写入退出；选择该入口只进入 skill 管理菜单。
- 空项目执行 `plugin update --version <range>`（无 Plugin ID）：仍返回 `PLUGIN_USAGE_ERROR` 退出码 `2`，不被空项目短路吞掉。
- dry-run 计划包含目标变化和孤立依赖，但项目字节、mtime 和事务目录不变化。
- GitHub 来源预览发现两个格式入口：交互模式展示候选并固定用户选择；同一输入在非 TTY 下返回结构化歧义错误。
- 同一 lock 和平台选择重复应用：第二次目标与 plugins/lock/state 全部 changed-only。

### Bad

- CLI 在解析完成前直接写 `plugins.json`，然后再下载依赖或检查冲突。
- local Plugin 在无平台项目中隐式创建 `.claude/skills`。
- Provider 返回绝对缓存路径进入 lock/JSON，或 Resolver 直接访问网络和目标文件系统。
- 为 GitLab 或 Patch capability 复制一套依赖求解、InstallPlan 或事务 writer。
- 无 `.trellis/` 目标中用 `SkillGardenBuiltinProvider.listCandidates()` 加载发现页入口，导致
  common-only 场景被 `resolveEnhancementSnapshot()` 挡住并写入问题页签。
- `flower-trellis update` 重放 `flower/skill-garden` 时不传 `--platform`，导致 Runtime 复用污染的旧
  `.flower/state.json.platforms` 并重新创建未启用平台目录。
- 在 Provider 内按遍历顺序选择第一个外部 manifest，或让 Adapter 直接写 `.agents/skills`、`.claude/skills`、`.flower/`。
- 交互层对多个越界声明逐个调用 `update <id> --version <range>`：第一条命令就会在另一个不可重放的锁定包上失败，越界越多越死锁。
- 交互层先用未放宽的 `update --dry-run` 做预览再询问用户：预览必然以退出码 `3` 失败，用户只看到提示后直接中断。

## 6. Tests Required

- `plugin-source-registry.test.js`：builtin/local 标准候选、重复 source、固定包漂移、路径去重和可选 capability 晚加载回补。
- `plugin-dependency-resolver.test.js`：传递/共享依赖、稳定顺序、lock-first、显式 update、缺失、歧义、冲突、自依赖、循环和 orphan。
- `plugin-content-projector.test.js`：显式/检测平台、共享物理 root、override、无平台阻断，以及 `contentSelection.skills` 过滤、缺失选择和 basename 重复。
- `plugin-install-planner.test.js`：同目标、ownership、用户文件、文件目录前缀及普通内容/Patch 冲突。
- `plugin-transaction-writer.test.js`：before/payload 漂移、state 最后写、changed-only、dry-run、回滚和 retained evidence。
- `plugin-format-adapters.test.js`：Flower/Codex/Claude/skill-only 检测、歧义、路径边界、commands 转换、主动组件仅诊断和标准包校验。
- `plugin-interactive.test.js` 与 `plugin-remote-cli.test.js`：歧义选择、非 TTY 零 prompt、兼容预览、普通 Marketplace Plugin 的 Skill 子集选择、远程 manifest Skill inspection、临时 cache 成功/失败清理和确认前零持久化。
- no `.trellis` common-only 回归必须覆盖：`aliyun-ops-skill.test.js` 断言 `listSkillCatalog()` 返回
  common 清单、空 `enhancementSkills`、安装/停用不创建 `.flower`；`plugin-interactive.test.js`
  断言发现页内置入口不读取 Provider 候选且只调用 `openSkillManager()`；`plugin-e2e-interactive.test.js`
  断言真实 TTY 裸 `plugin` 首页显示内置入口并零写入退出。
- `plugin-lifecycle-cli.test.js`：parser、真实 add/update/remove/verify、空项目 update、无平台零写入、JSON/人类输出、短 ID 和退出码。断言点还须覆盖：`--content-skill` 重复/逗号归一化、add/update 持久化并过滤 Skill、非法或越界命令拒绝；`--widen` 的重复取值与含 `=` range 的切分；多个精确锁同时越界时逐个 `--version` 失败于 `已锁定 Plugin 包不可重放` 而批量 `--widen` 成功；批量 dry-run 后 `plugins.json` 零写入；未越界声明保持原样；空项目 `update --version` 返回退出码 `2`。
- `trellis-control.test.js`：disabled 项目真实 `plugin add` 后外部 Skill、声明和 state 保留，Trellis
  平台入口重新 detach，最终 `inspectTrellisControl().status === "disabled"`；同时覆盖 excluded spec
  精确快照恢复和外层补偿不完整时的 `repair-required` 持久化。
- `plugin-skill-garden.test.js`：builtin trust/digest、legacy 迁移、冻结 replay、shared common ownership 和 state/hash 卸载。
- `update-backups.test.js`：`flower-trellis update` 的 Skill-Garden 重放必须覆盖污染平台 state
  收窄；断言旧 state 含 `gemini/zcode` 而 Trellis hash 只含 Claude/Codex 时，新 state 只保留
  `claude/codex`，且纯旧 `.gemini/.zcode` check-all agent 目录被清理；精确 Plugin target 即使位于
  普通快照排除的 `.trellis/spec` 也必须可恢复，而未声明的其它 spec 保持不变。
- 修改本契约后必须运行完整 `npm test`、`npm pack --dry-run --json`、全部受影响 JS 的 `node --check` 和 `git diff --check`。

## 7. Wrong vs Correct

### Wrong

```js
const provider = new GitLabSourceProvider(options);
const graph = await provider.resolveAndInstall(pluginId, projectRoot);
fs.writeFileSync(".flower/plugin-lock.json", JSON.stringify(graph));
```

这种写法让远程来源跨越 Provider 边界，自定义依赖解析与写盘，并绕过 P1 schema、统一 preflight、dry-run 和 rollback。

### Correct

```js
const registry = new SourceRegistry();
registry.register(provider);
const service = new PluginApplicationService(projectRoot, { registry });
const result = service.add({ id: "rd-guide/demo", version: "^1.0.0", platforms: ["codex"] });
```

Provider 只产出和复核固定包；Application Service 统一协调 Resolver、平台投影、InstallPlan 和 Transaction Writer。新增来源或 capability 只能接入这些公共边界，不能复制生命周期实现。

外部格式的正确接入同样先调用 `PluginFormatRegistry.detect()/normalize()` 产生标准候选，再把候选交给既有 `SourceRegistry` 与 `PluginApplicationService`；禁止为 Claude Code/Codex 另建 Installer 或直接复制上游目录。

放宽越界声明的 Wrong / Correct：

#### Wrong

```js
// 逐个放宽：第一条命令就会在另一个不可重放的锁定包上抛 PLUGIN_TARGET_DRIFT
for (const entry of widened) {
  await runCommand(["update", entry.id, "--version", entry.nextRange]);
}
await runCommand(["update"]);
```

`update({id})` 只把该节点放进 `updateIds`，其余节点仍走 lock-first。当另一个精确锁的锁定包已从来源消失时立即抛 `已锁定 Plugin 包不可重放`，两个方向互为阻塞。

#### Correct

```js
// 一次覆盖全部越界声明，并按 update="all" 解析
const args = ["update", ...widened.flatMap(({ id, nextRange }) => ["--widen", `${id}=${nextRange}`])];
if (await runCommand([...args, "--dry-run"]) !== 0) return;
if (await confirm()) await runCommand(args);
```

预览与执行使用同一组参数，所以预览不会因为"还没放宽"而失败；`update="all"` 让每个节点都允许升级，互锁被一次解开。

无 Trellis common-only 入口的 Wrong / Correct：

#### Wrong

```js
if (!fs.existsSync(path.join(target, ".trellis"))) {
  const candidate = provider.listCandidates(SKILL_GARDEN_PLUGIN_ID)[0];
  return [{ kind: "builtin", id: candidate.id, version: candidate.version }];
}
```

`provider.listCandidates()` 会解析增强快照，目标没有 `.trellis/` 时会抛错并把 common skill 管理路径误升级成正式 Plugin Runtime。

#### Correct

```js
if (!fs.existsSync(path.join(target, ".trellis"))) {
  return [{ kind: "builtin", id: SKILL_GARDEN_PLUGIN_ID, version: flowerVersion() }];
}
```

无 `.trellis/` 分支只负责把用户带到既有 `skill-manager` action；common skill 的启停继续由
`listSkillCatalog()`、`installCommonSkills()` 和 `removeCommonSkills()` 按平台目录事实处理。
