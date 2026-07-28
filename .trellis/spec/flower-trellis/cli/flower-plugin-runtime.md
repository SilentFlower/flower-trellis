# Flower Plugin Runtime And Lifecycle

> 本规范定义 Flower Plugin v1 的 Source Registry、依赖解析、多平台内容投影、统一安装计划、事务写入和项目级生命周期 CLI。公共 DTO、schema、摘要与 `.flower/` 文件格式以 [Flower Plugin Contracts](./flower-plugin-contracts.md) 为唯一来源。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/application-service.js`、`resolver/**`、builtin/local Source Provider、`install/**` 或 `src/commands/plugin.js` 的生命周期路径。
- 改变 `plugin list/add/update/remove/verify` 参数、退出码、JSON 输出、平台检测、锁定优先、依赖求解、目标 ownership 或事务恢复语义。
- 为 GitLab、Patch capability、内置 Plugin 或作者工具接入基础 Runtime。

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
projectPluginContent(options) -> ContentProjection
createInstallPlan(graph, mutations, options) -> InstallPlan

new TransactionWriter(projectRoot, options)
TransactionWriter.apply(input) -> TransactionResult

new PluginApplicationService(projectRoot, { registry, store?, writer?, platformDetector? })
PluginApplicationService.list() -> { plugins, lock, state }
PluginApplicationService.add(options) -> LifecycleResult
PluginApplicationService.update(options?) -> LifecycleResult
PluginApplicationService.remove(options) -> LifecycleResult
PluginApplicationService.verify(options?) -> { ok, diagnostics }

parsePluginArgs(argv) -> PluginCommand
plugin(ctx, options?) -> Promise<0 | 1 | 2 | 3>
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
- 候选、约束、roots、orphans 和 lock 输出必须按 UTF-8 稳定排序，不能依赖 Provider、对象或文件系统返回顺序。

### Platform And Install Plan

- 平台名单只从 `ENHANCEMENT_SKILL_TARGETS` 派生。显式 `--platform` 必须全部合法；未显式选择时只检测项目中已存在的原生 root。
- 完全没有可用平台时返回 `PLUGIN_PLATFORM_SELECTION_REQUIRED`，不得沿用增强链的 Claude fallback，也不得创建 `.trellis/` 或安装 `skill-garden`。
- 多个逻辑平台共享同一物理 root 时只生成一个 mutation，并在 provenance 中保留全部逻辑平台。
- `createInstallPlan()` 在写盘前统一检查安全相对路径、父路径软链、同目标多 owner/内容、文件目录前缀、现有用户文件和 state ownership。
- 普通内容与后续 Patch mutation 必须进入同一个 `InstallPlan`；不能建立第二套 writer 或依赖写入顺序解决冲突。

### Transaction And Lifecycle

- 所有目标、声明、lock 和 state 在任何写入前完成解析、包摘要、平台、payload 和冲突 preflight。
- `TransactionWriter` 写前复核 target/directory before hash 和 payload after hash；任一漂移时不得创建成功 state。
- 写入顺序固定为目标 mutation、`plugins.json`、`plugin-lock.json`、最后 `state.json`。失败时逆序恢复；恢复不完整时保留 `.flower/transactions/<id>/` 证据并返回 repair blocker。
- `dryRun` 返回同一 graph、plan、changes 和 diagnostics，但不创建 `.flower/`、事务目录或目标文件。
- changed-only：before/after hash 相同的目标不重写；空项目 `plugin update` 返回 `unchanged`，且不初始化 Runtime。
- `remove` 只删除 state 中归属当前 Plugin 且当前 hash 仍匹配的路径，并只清理不再从 roots 可达的传递依赖。
- `verify` 只读检查声明、lock roots/可达性、固定包、state ownership、版本和目标 hash，不更新 Provider、不修复文件。

### Optional Runtime Boundaries

- `src/commands/plugin.js` 可以通过 `import()` 按需加载 `plugin-remote.js` 和 Patch planner；基础模块不得静态导入 GitLab/OAuth、用户 source store 或 capability planner。
- 远程模块只负责管理命令、Provider 登记和异步候选准备；最终依赖解析、计划、事务和输出结果仍由 P2 Application Service 完成。
- 进程内扩展注册必须与模块加载顺序无关：扩展实现晚于基础对象加载时，需要回补此前等待的实例或请求，不能静默丢失。

## 4. Validation & Error Matrix

| 条件 | 错误 / 结果 | 写入边界 |
| --- | --- | --- |
| Provider 缺少接口或 source 重复 | `TypeError` / `PLUGIN_SOURCE_DUPLICATE` | Resolver 未运行 |
| source 未注册或候选来源歧义 | `PLUGIN_SOURCE_NOT_FOUND` / `PLUGIN_SOURCE_AMBIGUOUS` | 零写入 |
| 依赖缺失、约束冲突、自依赖或循环 | `PLUGIN_DEPENDENCY_MISSING` / `PLUGIN_DEPENDENCY_CONFLICT` / `PLUGIN_DEPENDENCY_CYCLE` | 零写入，details 保留稳定约束或 cycle |
| 平台未知或未选择 | `PLUGIN_PLATFORM_UNKNOWN` / `PLUGIN_PLATFORM_SELECTION_REQUIRED` | 不创建 `.flower/` 和平台 root |
| 同目标 ownership/内容或前缀冲突 | `PLUGIN_CONTENT_CONFLICT` | 事务目录尚未创建 |
| 计划后 target、directory 或 payload 漂移 | `PLUGIN_TARGET_DRIFT` | project files 不写入 |
| 事务中途失败且恢复成功 | `PLUGIN_TRANSACTION_FAILED` | 目标和三类 project files 恢复 |
| 恢复或事务清理不完整 | `PLUGIN_TRANSACTION_REPAIR_REQUIRED` | 保留事务证据，不写成功 state |
| CLI 参数错误 | 退出码 `2` | JSON diagnostics 不含绝对路径 |
| 验证或内容冲突 | 退出码 `3` | 零写入或只读 verify |
| 其它执行失败 | 退出码 `1` | 按事务边界恢复 |

## 5. Good / Base / Bad Cases

### Good

- 项目显式选择 `codex`，安装 `local/demo` 及其共享依赖；共享 `.agents/skills` 只产生一个目标 mutation，lock 使用稳定依赖优先顺序。
- 项目已有 lock 且约束未变：普通 add/remove 重算仍保持兼容旧版本；显式 update 才升级目标节点。
- P3 动态加载远程适配器、准备 GitLab Provider 后，把同一 `SourceRegistry` 交给 Application Service，远程包与 local/builtin 包走相同 Resolver 和事务。

### Base

- 空项目执行 `plugin list` 或无参数 `plugin update`：返回空视图或 `unchanged`，不创建 `.flower/`。
- dry-run 计划包含目标变化和孤立依赖，但项目字节、mtime 和事务目录不变化。
- 同一 lock 和平台选择重复应用：第二次目标与 plugins/lock/state 全部 changed-only。

### Bad

- CLI 在解析完成前直接写 `plugins.json`，然后再下载依赖或检查冲突。
- local Plugin 在无平台项目中隐式创建 `.claude/skills`。
- Provider 返回绝对缓存路径进入 lock/JSON，或 Resolver 直接访问网络和目标文件系统。
- 为 GitLab 或 Patch capability 复制一套依赖求解、InstallPlan 或事务 writer。

## 6. Tests Required

- `plugin-source-registry.test.js`：builtin/local 标准候选、重复 source、固定包漂移、路径去重和可选 capability 晚加载回补。
- `plugin-dependency-resolver.test.js`：传递/共享依赖、稳定顺序、lock-first、显式 update、缺失、歧义、冲突、自依赖、循环和 orphan。
- `plugin-content-projector.test.js`：显式/检测平台、共享物理 root、override 和无平台阻断。
- `plugin-install-planner.test.js`：同目标、ownership、用户文件、文件目录前缀及普通内容/Patch 冲突。
- `plugin-transaction-writer.test.js`：before/payload 漂移、state 最后写、changed-only、dry-run、回滚和 retained evidence。
- `plugin-lifecycle-cli.test.js`：parser、真实 add/update/remove/verify、空项目 update、无平台零写入、JSON/人类输出、短 ID 和退出码。
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
