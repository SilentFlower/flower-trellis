# Design — Flower Plugin 管理器体验与更新链路修复

## 架构边界

改动集中在三层，不触碰解析器、投影器、事务写入器的既有语义：

| 层 | 文件 | 改动性质 |
| --- | --- | --- |
| CLI 入口 | `src/commands/plugin.js` | 延迟加载、输出过滤、放开 `--version` 到 `update`、新增 `--widen` |
| 交互层 | `src/commands/plugin-interactive.js` | 登录态缓存、去平台询问、已安装态展示、批量放宽协商 |
| 服务层 | `src/plugin/application-service.js` | `update()` 支持 `widen` 覆盖表；修正用法守卫顺序 |

`resolvePluginGraph`、`projectPluginContent`、`TransactionWriter` 保持原样。

> **范围修正（Check-All 第一轮后）**：原设计写「服务层不改」。Check-All 实测证明该边界下 R5 无法达成——见下节「批量放宽」。用户在检查报告上选择 `修复全部`，据此扩大到服务层的 `update()` 入口，解析器本身仍不动。

## R1 · 延迟加载

`trellis-control.js` 在 `plugin.js` 中只有一个使用点（`plugin.js:691` 的 `runWithTrellisIntegrationEnabled`），且该分支已被 `["add","update","remove","replay"].includes(command) && !dryRun && !trellisAlreadyMaterialized` 三重守卫。

把顶层静态 import 改为分支内 `await import()`。`list` / `verify` / `search` / `source` / `auth` / 交互管理器首屏都不再触发 `@mindfoldhq/trellis` 的加载。

登录态缓存：`state` 增加 `authStatuses: Map<string, object>`，`buildManagerModel` 优先读缓存。失效点与 `state.discovery = null` 完全一致（认证成功、来源增删改启停），因此复用同一个失效动作，新增 `invalidateDiscovery(context)` helper 同时清两者，避免二者漂移。

## R2 · 计划输出过滤

**判定依据用 `result.transaction.changed`，不是 `beforeHash !== afterHash`。**

原因：`ensure-directory` 的 `afterHash` 恒为 `null`，新建目录时 `beforeHash` 也是 `null`，朴素比较会把真实的新建目录误判为空操作（`application-service.js:735-741` vs `transaction-writer.js:140`）。`transaction.changed` 是事务层的权威结论，且 dry-run 分支同样填充（`transaction-writer.js:154-162`），与标题里的"目标变化 N 项"天然一致。

```
const changedTargets = new Set(result.transaction.changed);
const visible = result.changes.filter(({ target }) => changedTargets.has(target));
const hidden = result.changes.length - visible.length;
```

`visible` 逐条打印，`hidden > 0` 时追加一行汇总。`--json` 分支在 `printResult` 顶部提前 return，天然不受影响（R2.3 / AC4 自动满足）。

## R3 · 平台推断

删除 `installPlugin` 中的 `prompts.checkbox` 与 `withPlatforms`，直接 `["add", id, "--version", range]`。

服务层已有兜底链（`application-service.js:453-457`）：显式平台 → 既有 state 平台 → 项目探测。仅当项目无任何平台证据时 `detectPluginPlatforms` 抛 `PLATFORM_SELECTION_REQUIRED`（`platform-detector.js:63-68`），此时 dry-run 会以退出码 2 失败。

在 `installPlugin` 中捕获这一路径：dry-run 非零退出且诊断指向平台缺失时，弹一次平台多选并带 `--platform` 重试。为拿到结构化错误码，`runChecked` 增加可选的 `captureError` 能力——记录最近一次失败的错误对象而不仅是退出码。

`defaultPlatforms` / `withPlatforms` 保留，供该兜底路径复用。

## R4 · 发现页已安装态

`buildDiscoverItems` 已经能拿到 `plugin.versions`，缺的是项目侧视图。在 `buildManagerModel` 里先读 `readProjectView`，把 `{declared, lockedVersion}` 索引传入 `buildDiscoverItems`。

注意：`state.discovery` 是跨循环缓存的，而已安装态在安装/卸载后会变。因此**已安装态不进缓存**——缓存只存 Marketplace 侧的 `plugin` 记录，条目的 badge/meta 在每次 `buildManagerModel` 时基于当前项目视图重新计算。这样安装完回到列表立刻能看到状态变化，且不需要重新联网。

结构调整：`state.discovery` 从缓存"成品 items"改为缓存"原始 entries"（`{kind:"plugin"|"auth"|..., ...}`），渲染成 items 的逻辑每次重跑。

| 状态 | badge | tone | meta |
| --- | --- | --- | --- |
| 未安装 | `source.id` | info | `来源名 · 最新版` |
| 已安装且最新 | `已安装` | success | `来源名 · 0.4.0` |
| 已安装可更新 | `可更新` | warning | `来源名 · 0.3.0 → 0.4.0` |

已安装条目的 action 改为 `{type:"installed", pluginId}`，复用 `manageInstalledPlugin`（R4.3）。

## R5 · 版本协商

### 声明格式

安装写 `^<version>`（`semver` 的 caret）。`0.x` 下 `^0.4.0` 等价 `>=0.4.0 <0.5.0`，与用户确认的预览语义一致。

### 更新目标计算

新增纯函数 `planVersionUpdate({ declared, available })`：

```
latest = available.sort(semver.rcompare)[0]
inRange = semver.satisfies(latest, declared)
if (inRange)  → { action: "in-range" }                  // 交给现有 update，无需 --version
else          → { action: "widen", nextRange: `^${latest}`, latest }  // 需显式确认
```

`available` 来自 `state.discovery` 缓存的 Marketplace 记录，无额外网络请求。来源被停用或不在发现结果中时返回 `{ action: "unknown" }`，退回当前行为。

`flower/skill-garden` 跳过该逻辑（内置 Plugin，版本随 flower 本体，`plugin.js:820` 已单独处理）。

### 交互流

`manageInstalledPlugin` 的 update 分支与 `updateAllPlugins` 共用 `runUpdate(context, plan, pluginId)`：

1. `collectWidenPlan` 算出全部越界声明
2. 计划非空时展示逐条 `id  declared → ^latest（latest）`，并入**一次**确认
3. 单 Plugin 场景下若被选中的 Plugin 本身在范围内、而其它声明越界，额外说明「不放宽这些则整图无法解析」
4. dry-run 与正式执行使用同一组参数
5. 拒绝则不执行任何命令（AC10：三个状态文件均不写）

失败处理（R5.5）：`runChecked` 失败时记入问题页，并置 `state.lastFailure`；主循环在清屏前停下让用户读完。

### 批量放宽（Check-All 第一轮修正）

**问题**：`dependency-resolver.js:81-87` 对不在 `updateIds` 的节点执行 lock-first；当该节点的锁定包已从 Marketplace 移除且仍满足其声明范围时抛 `已锁定 Plugin 包不可重放`。因此多个精确锁同时落后时，放宽 A 被 B 挡住、放宽 B 又被 A 挡住，互相死锁。同时 `updateAllPlugins` 用未放宽的全量 dry-run 做预览，任何需要放宽的场景都在确认前就退出。

**方案**：放宽必须一次覆盖全部被阻塞的声明，并按 `update: "all"` 解析——此时每个节点都 `allowUpdate=true`，不再触发 lock-first 抛错。

- 服务层 `update({ widen })`：`widen` 是 `id → range` 覆盖表，与 `id` 互斥，命中时 `update` 恒为 `"all"`。
- CLI `--widen <plugin>=<range>`（可重复）。取值形态固定为 `id=range`，按**第一个** `=` 切分，`>=1.0.0` 这类含 `=` 的 range 落在右侧不受影响。
- 交互层只在计划非空时改用该命令；未越界的声明不进集合，保持原样。

**为什么不用重复 `--version`**：`--version` 的裸 range 形态与 `id=range` 形态无法安全区分（`>=1.0.0` 本身含 `=`），需要靠"左侧是否为合法 plugin id"反推，语义脆弱。独立 flag 无歧义。

### 用法守卫顺序修正

`update()` 中 `version && !id` 的用法校验原本排在空项目短路之后，导致空项目里 `plugin update --version <range>` 静默返回 unchanged。守卫提前到短路之前，`widen` 的声明存在性校验同样前置。

### CLI 侧放开

`parsePluginArgs` 的 `command !== "add" && (source || version)` 守卫改为：`--source` 仍限 `add`，`--version` 允许 `add` 与 `update`。`updateOptions` 透传 `parsed.version`；`service.update` 早已支持 `options.version`（`application-service.js:181-194`），无需改服务层。

保留既有校验：`update` 传 `--version` 时必须同时给 Plugin ID（`application-service.js:181-186` 已抛 USAGE_ERROR）。

## 兼容性与迁移

- `plugins.json` schema 不变，`version` 一直是 SemVer range 字符串，`^0.4.0` 是合法值。
- 存量精确锁不做批量改写，只在用户对该 Plugin 执行更新时就地放宽（D2）。
- 已有 lock 不受影响；lock 记录的是解析结果的具体版本，与声明格式无关。
- `--json` 输出结构完全不变。

## 风险

| 风险 | 缓解 |
| --- | --- |
| `transaction.changed` 与 `changes` 的 target 命名若不一致会误过滤 | 二者都用 `mutation.target` / `claim.path` 的同一 POSIX 相对路径；加测试锁定 |
| 延迟加载改变 `trellis-control` 的加载时序，可能影响快照包裹范围 | 分支内 `await import()` 位置就在原调用点，时序不变；`trellis-control.test.js` 与 e2e 用例覆盖 |
| 发现页缓存结构调整可能破坏现有交互测试 | `plugin-interactive.test.js`（615 行）作为回归基线，改动后必须全绿 |
| 跨边界升级把 `0.3.0` 直接带到 `0.4.0`，可能引入不兼容内容 | 必须显式确认，且预览里会列出全部真实文件改动（R2 已让预览可读） |
