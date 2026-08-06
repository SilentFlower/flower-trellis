# Flower Plugin 管理器体验与更新链路修复

## Goal

让 `flower-trellis plugin` 交互管理器可以被日常使用：启动不再有明显等待、计划预览只显示真实改动、安装不再追问项目已经能推断的信息、发现页能看出装没装、已安装的 Plugin 能真正更新到新版。

用户价值：当前 5 个问题叠加导致管理器"看起来能用但办不成事"——更新点了没反应，卸载时刷屏一堆看不懂的路径，用户无法判断操作是否成功。

## Background

`.flower/plugins.json` 声明直接依赖，`.flower/plugin-lock.json` 锁定解析结果，`.flower/state.json` 记录本机投影。交互管理器 `src/commands/plugin-interactive.js` 通过 `runCommand` 复用 `src/commands/plugin.js` 的非交互实现，所有生命周期最终落到 `src/plugin/application-service.js#applyLifecycle`。

组织内 `rd-guide` Marketplace 每个 Plugin 只发布**一个**版本（已验证：4 个 Plugin 各 1 个版本），旧版本在发新版时被移除。这个事实决定了版本约束策略的可行范围。

## Confirmed Facts

| ID | 事实 | 证据 |
| --- | --- | --- |
| F1 | `plugin.js` 静态 import `trellis-control.js`，后者静态 import `@mindfoldhq/trellis/dist/configurators/index.js` | `src/commands/plugin.js:20`、`src/lib/trellis-control.js:5-8` |
| F2 | 该 import 链实测 241ms；`plugin.js` 整体 import 587ms；`ftl plugin list`（纯本地）端到端 676ms | 本地计时 |
| F3 | `runWithTrellisIntegrationEnabled` 只在 `add/update/remove/replay` 且非 `--dry-run` 时使用 | `src/commands/plugin.js:684-698` |
| F4 | `buildManagerModel` 每次主循环都对全部来源重查登录态，`discovery` 有缓存但 `statuses` 没有 | `src/commands/plugin-interactive.js:660-670` |
| F5 | `printResult` 打印全量 `result.changes`，不区分 `beforeHash === afterHash` 的空操作 | `src/commands/plugin.js:624` |
| F6 | `changes` 每条都带 `beforeHash`/`afterHash`；事务层已按二者是否相等分出 `changed`/`unchanged` | `src/plugin/application-service.js:720-749`、`src/plugin/install/transaction-writer.js:128-129` |
| F7 | 任何生命周期命令都会重新投影并重规划**整图**，所以卸载单个 Plugin 会连带列出 skill-garden 的幂等重写 | `src/plugin/application-service.js:437-466` |
| F8 | `installPlugin` 强制弹平台多选并拼 `--platform` | `src/commands/plugin-interactive.js:824-836` |
| F9 | `platforms` 为空时服务层自动回退 `statePlatforms(previousState)`，再空则 `detectPluginPlatforms(projectRoot)` 自动探测 | `src/plugin/application-service.js:453-457`、`src/plugin/install/platform-detector.js:56-62` |
| F10 | `buildDiscoverItems` 构造条目时未读取 `plugins.json` / lock，无法显示已安装态 | `src/commands/plugin-interactive.js:584-599` |
| F11 | `installPlugin` 传 `--version <精确版本>`，写入 `plugins.json` 即成为精确锁 | `src/commands/plugin-interactive.js:817-836` |
| F12 | 解析器按声明 range 过滤候选，精确锁使 `update` 永远选不到新版 | `src/plugin/resolver/dependency-resolver.js:216-222` |
| F13 | 声明 range 与 Marketplace 可用版本无交集时抛 `PLUGIN_DEPENDENCY_CONFLICT`，非静默无操作 | 本地复现：声明 `^0.4.2`、候选仅 `0.5.0` → `Plugin 版本约束无法同时满足` |
| F14 | 交互层 `runChecked` 把非零退出码记入"问题"页，用户在列表页看不到失败细节 | `src/commands/plugin-interactive.js:529-533` |
| F15 | `--version` 接受任意合法 SemVer range | `src/commands/plugin.js:268`、`src/plugin/schemas/shared.js:87-89` |
| F16 | 项目现存 4 个 rd-guide 声明均为精确锁，且其中 3 个已落后于 Marketplace | `.flower/plugins.json` vs `plugin search --json` |
| F17 | 解析器对不在 `updateIds` 的节点执行 lock-first；锁定包已从 Marketplace 移除但仍满足声明范围时抛 `已锁定 Plugin 包不可重放`。因此多个精确锁同时落后会互相死锁 | `dependency-resolver.js:81-87`；夹具实测 `update alpha --version ^0.4.0` → `已锁定 Plugin 包不可重放:local/beta@0.2.1`，反向亦然 |
| F18 | `update: "all"`（无 Plugin ID）时全部节点 `allowUpdate=true`，不触发 F17 的抛错 | `dependency-resolver.js:171-173, 216-221` |

由 F11 + F12 + F13 + F14 可解释用户报告的"更新没用，还是旧版"：更新实际抛错退出，错误被收进"问题"页，列表页版本不变。

## Key Decisions

| ID | 决策 | 归属 |
| --- | --- | --- |
| D1 | 安装写入 `^x.y.z` 兼容范围，不写精确版本 | 用户已确认 |
| D2 | 存量精确锁在执行更新时自动放宽，不需要用户手工改 `plugins.json` | 用户已确认 |
| D3 | Marketplace 只有一个版本时跳过"选择版本"，多版本才弹 | 用户已确认 |
| D4 | 跨兼容边界（`^` 覆盖不到）的升级必须在更新预览里显式呈现并确认，不静默跳版本 | 由 D1 预览语义推导 |
| D5 | 平台不再询问，一律走服务层既有推断；仅当服务层抛 `PLATFORM_SELECTION_REQUIRED` 才提示 | 由 F9 推导 |

## Requirements

### R1 · 缩短交互管理器启动时间

- R1.1 `plugin.js` 改为按需加载 `trellis-control.js`，仅在真正需要物化 Trellis 的路径（非 `--dry-run` 的 `add/update/remove/replay`）加载。
- R1.2 交互管理器把来源登录态缓存进 `state`，与 `discovery` 同生命周期失效（认证、来源增删改后失效）。
- R1.3 不改变任何现有命令的可观察行为，只改变加载时机。

### R2 · 计划预览只显示真实改动

- R2.1 `printResult` 只列出 `beforeHash !== afterHash` 的条目。
- R2.2 被过滤掉的空操作以一行汇总呈现（如 `· 另有 N 项目标无变化`），不逐条刷屏。
- R2.3 `--json` 输出保持全量 `changes` 不变，避免破坏既有消费方。
- R2.4 卸载单个 Plugin 时，预览只出现该 Plugin 自己的路径。

### R3 · 安装不再询问平台

- R3.1 移除安装流程中的平台多选，不再拼 `--platform`。
- R3.2 服务层抛 `PLATFORM_SELECTION_REQUIRED` 时，才回退到平台选择提示并重试。
- R3.3 `--platform` 作为非交互 CLI 参数继续保留。

### R4 · 发现页显示已安装状态

- R4.1 已安装的 Plugin 在发现页显示已安装徽标与当前版本。
- R4.2 Marketplace 版本高于已安装版本时，显式标记可更新并显示 `当前版本 → 可用版本`。
- R4.3 已安装条目回车后进入该 Plugin 的管理动作，而不是重复走安装流程。

### R5 · 已安装 Plugin 能真正更新

- R5.1 安装时向 `plugins.json` 写 `^<选定版本>`。
- R5.2 更新时若声明为精确锁，自动放宽为兼容范围。
- R5.3 Marketplace 最新版落在声明范围外时，更新预览显式展示跨边界升级并要求确认；确认后把声明改写为 `^<最新版>`。
- R5.4 用户拒绝跨边界升级时不写入任何内容，并明确告知未更新。
- R5.5 更新失败时，失败原因直接呈现在当前操作流里，不只沉默地进"问题"页。
- R5.6 放宽必须一次覆盖**全部**越界声明。多个精确锁同时落后时，逐个放宽会在解析器的 lock-first 检查上互相死锁（见 F17），因此批量放宽是达成 R5 的必要条件，未越界的声明保持原样。
- R5.7 需要放宽时，更新预览本身必须携带放宽范围；不得先用未放宽的参数做预览。

## Acceptance Criteria

- [x] AC1：`ftl plugin list` 端到端耗时相对当前基线（676ms）明显下降；`trellis-control.js` 不出现在该路径的模块图中。
- [x] AC2：非 `--dry-run` 的 `plugin add/update/remove` 仍然在 `runWithTrellisIntegrationEnabled` 包裹下执行，既有 `trellis-control` 测试全绿。
- [x] AC3：卸载一个 rd-guide Plugin 的预览中，只出现该 Plugin 自身路径；skill-garden 的 `.trellis/`、`.codex/` 幂等重写不再逐条列出，改为一行汇总。
- [x] AC4：`plugin remove <id> --dry-run --json` 的 `changes` 数组内容与改动前一致。
- [x] AC5：从发现页安装一个 Plugin 全程不出现平台选择；`.flower/state.json` 中该 Plugin 的 `platforms` 与项目既有平台一致。
- [x] AC6：在无任何平台证据的空目录中安装，仍能得到平台选择提示而非直接失败。
- [x] AC7：发现页中已安装的 Plugin 显示已安装徽标与版本；有新版时显示 `0.3.0 → 0.4.0` 形式的可更新提示。
- [x] AC8：安装 `0.4.0` 后，`.flower/plugins.json` 中该条目 `version` 为 `^0.4.0`。
- [x] AC9：对精确锁 `0.3.0`、Marketplace 仅有 `0.4.0` 的 Plugin 执行更新，预览显示跨边界升级并要求确认；确认后 `plugins.json` 变为 `^0.4.0`、lock 与 state 版本变为 `0.4.0`。
- [x] AC10：AC9 场景中选择否，`plugins.json`、`plugin-lock.json`、`state.json` 三者均无变化。
- [x] AC12：三个精确锁声明中有两个落后时，一次批量放宽即可完成更新；只放宽其中一个必须失败，未越界的第三个声明保持原样。
- [x] AC13：空项目中 `plugin update --version <range>`（无 Plugin ID）返回退出码 2 用法错误，而非静默零变化。
- [ ] AC11：`npm test` 全绿。

## Out of Scope

- `已锁定 Plugin 包不可重放` 这一 lock 漂移硬失败的处理策略（本仓自举时因 `vendor/skill-garden` 脏工作区触发，属独立问题）。
- Marketplace 索引的跨进程磁盘缓存。
- GitLab 登录、来源管理、Plugin 创作等其他页签的交互改造。
- `flower/skill-garden` 内置 Plugin 自身的版本策略（其版本随 flower 本体，不走 Marketplace range）。
