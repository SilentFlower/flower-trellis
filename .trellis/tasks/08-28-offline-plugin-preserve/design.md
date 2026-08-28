# 技术设计：离线冻结未受影响的外部 Plugin

## 1. 当前问题

当前 targeted update 仍采用完整图重放：

```text
update flower/skill-garden
  -> prepareRemoteLock(全部远程 lock)
  -> resolvePluginGraph(完整图)
  -> projectPluginContent(完整图，读取全部固定包)
  -> preserveIds 在投影后过滤 mutation
```

因此 `preserveIds` 只冻结写入结果，不能冻结来源准备。公司 GitLab 不可达时，Runtime 在
preflight 前就因 `PLUGIN_AUTH_REQUIRED` 退出，随后 Flower update 补偿恢复全部升级内容。

## 2. 目标数据流

```text
update flower/skill-garden
  -> 计算 preservedIds = 已锁定图 - 本轮更新目标
  -> 只准备活跃候选
  -> Resolver 对冻结节点使用 lock 合成候选
  -> 只投影活跃节点
  -> 校验并合并旧冻结 state/lock
  -> 检查活跃 mutation 与冻结 ownership/Patch target 冲突
  -> 复用现有 InstallPlan + TransactionWriter 原子提交
```

## 3. 设计决策

### D1. 冻结只由调用方显式传入

`replayPlugins()` 在更新内置 Skill-Garden 时从旧 lock 计算外部 `preserveIds`。普通
`plugin update <external>` 不传该集合，因此外部 Plugin 的显式更新仍要求来源可达。

该机制保持内部化，不增加容易被误用的 `--skip-auth`。后续若需要公开离线模式，应另行设计
用户可见的风险确认和诊断协议。

### D2. Resolver 直接消费锁定候选

为 `resolvePluginGraph()` 增加 `preserveIds` 选项。遇到冻结 ID 时，从 `lockedPlugins` 合成
只用于求解的 `PluginCandidate`：

- identity 取旧 lock 的 `id/version/source/commit/integrity`；
- manifest 只承载精确 dependencies、compatibility 和由旧 grant 映射出的 capability request；
- content 为空，且候选不得进入包读取或投影；
- 声明范围或活跃依赖范围不接受该精确版本时，继续使用现有依赖冲突错误。

这样不需要修改 `SourceRegistry` 或伪造远程 Provider 缓存，也不会让冻结元数据变成可安装包。

### D3. 投影前拆分活跃图与冻结图

`PluginApplicationService.#applyLifecycle()` 在依赖解析后拆出：

- `activeGraph/activeSelected`：进入 `projectPluginContent()` 与 Patch planner；
- `preservedIds`：从旧 state/lock 原样合并，不调用 `registry.readPackage()`。

合并后的 graph 仍保持 Resolver 的拓扑顺序；冻结 graph entry 最终替换为旧 lock entry，冻结
state entry 使用深复制。`desiredPaths` 基于合并后的 state 计算，避免把冻结路径误判为孤立删除。

### D4. 冻结状态必须先校验

在生成事务前，逐项校验冻结 state：

- 文件使用现有 `hashFileIfExists()`；
- 目录使用现有 `hashDirectoryIfExists()`，继续遵守忽略 `__pycache__`/`.pyc` 的安装态摘要规则；
- 缺失或摘要不一致返回现有稳定 drift/conflict 错误；
- lock/state 任一缺失时继续返回 `PLUGIN_TARGET_DRIFT`。

冻结不是忽略状态，而是证明既有安装仍可安全保持不变。

### D5. 禁止活跃计划修改冻结目标

从旧冻结 state 建立以下保护集合：

- exclusive/shared 文件路径；
- directory ownership 前缀；
- Patch target。

活跃 content mutation、Patch mutation、目录 claim/removal 若与保护集合相交，必须在
Transaction Writer 前返回 `PLUGIN_CONTENT_CONFLICT` 或 `PLUGIN_TARGET_DRIFT`。尤其不能允许活跃
Patch 改写冻结 Patch target，否则冻结 entry 的 `resultHash` 会立即失效。

### D6. migration 由实际活跃 owner 决定

活跃 Skill-Garden 投影产生 migration 时使用新投影结果。只有本轮投影没有 migration、且旧 state
存在 migration 时才沿用旧值，以兼容冻结 Skill-Garden 的现有 replay 用例。

### D7. 原子事务与补偿链不变

修复只改变 preflight 输入，不增加第二套 writer。最终 graph、mutation、lock/state 仍进入现有
`createInstallPlan()` 和 `TransactionWriter`；Flower update 外层补偿仍负责 Trellis + Plugin 整链失败恢复。

## 4. 影响文件

- `src/commands/update.js`：计算并传递外部冻结 ID。
- `src/commands/plugin.js` / `src/commands/plugin-remote.js`：把 `preserveIds` 传入 update 服务，并在
  远程 lock 准备阶段跳过冻结节点。
- `src/plugin/resolver/dependency-resolver.js`：支持由 lock 合成冻结候选。
- `src/plugin/application-service.js`：投影前拆分、冻结校验、state/lock 合并和目标冲突门禁。
- `test/js/plugin-dependency-resolver.test.js`：冻结候选约束求解。
- `test/js/plugin-skill-garden.test.js`：无包投影冻结与 migration 回归。
- `test/js/update-backups.test.js` 或新的 focused 测试：真实 update replay 在远程不可达时成功，
  冲突/漂移时仍补偿恢复。
- `.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md`：实现完成后记录离线冻结契约。

## 5. 兼容性与回滚

- 项目文件 schema 不变，无 migration。
- 在线完整重放和外部显式 update 不改变入口行为。
- 失败时仍由既有 Plugin Transaction 与 Flower update snapshot 回滚。
- 若实现导致 Resolver 或投影兼容性回归，可整体撤销 `preserveIds` 前移逻辑，旧行为会恢复为
  fail-closed，不会产生不可逆数据迁移。
