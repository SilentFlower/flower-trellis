# P2 交接：Flower Plugin Runtime 与生命周期

## 1. 稳定入口

| 领域 | 文件 | 公共入口 |
| --- | --- | --- |
| Runtime 错误 | `src/plugin/runtime-errors.js` | `PLUGIN_RUNTIME_ERROR_CODES`、`PluginRuntimeError` |
| Source 注册 | `src/plugin/sources/source-registry.js` | `SourceRegistry` |
| 内置来源 | `src/plugin/sources/builtin-provider.js` | `BuiltinSourceProvider` |
| 本地来源 | `src/plugin/sources/local-provider.js` | `LocalSourceProvider` |
| 依赖解析 | `src/plugin/resolver/dependency-resolver.js` | `resolvePluginGraph()` |
| Lock 构建 | `src/plugin/resolver/lock-builder.js` | `buildPluginLock()` |
| 平台选择 | `src/plugin/install/platform-detector.js` | `listPluginPlatforms()`、`detectPluginPlatforms()` |
| 内容投影 | `src/plugin/install/content-projector.js` | `projectPluginContent()`、`contentMutationKey()` |
| 普通计划 | `src/plugin/install/install-planner.js` | `createInstallPlan()` |
| 事务写入 | `src/plugin/install/transaction-writer.js` | `TransactionWriter` |
| 应用服务 | `src/plugin/application-service.js` | `PluginApplicationService` |
| CLI | `src/commands/plugin.js` | `parsePluginArgs()`、`plugin()` |

## 2. Source Provider 契约

Provider 必须公开：

```text
id: string
type: string
listCandidates(canonicalId): PluginCandidate[]
readPackage(candidate | resolvedPlugin): { root, manifest, integrity }
```

- `SourceRegistry` 按 canonical ID 前缀选择唯一 Provider；重复 source ID 直接失败。
- builtin/local 都复用 P1 `validatePluginManifest()` 与 `hashCanonicalTree()`。
- `readPackage()` 会重新计算身份和摘要，固定包漂移返回 `PLUGIN_TARGET_DRIFT`。
- P3 GitLab Provider 只需实现相同同步接口；如远端获取需要异步，应先在 P3 统一升级 Registry、Resolver 与 Application Service 边界，不能只让单个 Provider 返回 Promise。

## 3. Resolver 与 Lock

- `resolvePluginGraph()` 输入直接声明、Registry、旧 lock 与 update 集合，输出 `graph`、稳定拓扑对应的 `selected`、`orphans` 和完整约束来源。
- candidate 使用 SemVer 降序与 UTF-8 字节次序；普通重放优先不可变 lock，显式 update 才主动选择更高版本。
- 同一版本固定身份消失但旧版本仍满足约束时视为摘要漂移，不能静默重锁。
- 输出 `ResolvedGraph.plugins` 依赖优先；`buildPluginLock()` 只消费 graph 并再次调用 P1 lock validator。
- P4 能力裁剪可通过 `grantCapabilities(request, candidate)` 注入 resolver；P2 默认只记录请求，不执行 Patch 或 scripts。

## 4. 平台、内容与计划

- `ENHANCEMENT_SKILL_TARGETS` 保留旧 `platform/root/source` 字段，并新增 `platforms[]` 逻辑别名；Codex、Gemini、ZCode 共享一个 `.agents/skills` 物理目标。
- 无显式平台时只检测已存在的原生 root；无结果返回 `PLUGIN_PLATFORM_SELECTION_REQUIRED`，不走 Claude fallback。
- `projectPluginContent()` 将目录展开为逐文件 `ContentMutation`，payload 通过 `contentMutationKey()` 独立传给 writer，P1 DTO 不增加绝对路径或字节字段。
- 平台覆盖固定使用 `platforms/<platform>/<canonical-content-path>`；缺少覆盖时回退 canonical 内容，共享同一物理 root 的多个逻辑平台必须解析为相同字节，否则返回 `PLUGIN_CONTENT_CONFLICT`。
- Skill 写入平台原生 root；其它被动内容写入 `.flower/content/<canonical-id>/<kind>/`。
- `createInstallPlan()` 统一拒绝跨 owner 同路径、文件/目录前缀、用户文件、state ownership 歧义和软链父目录。
- P4 应把 `PatchMutation` 合并到同一个 `InstallPlan`，不要建立第二套 writer。

## 5. 事务与生命周期

- `TransactionWriter.apply()` 在任何写入前校验 plugins/lock/state schema、全部 before hash、payload hash和真实父路径。
- 写入顺序固定为：目标内容 -> `plugins.json` -> `plugin-lock.json` -> `state.json`；state 是最后一个成功文件写入。
- `.flower/transactions/<id>/` 保存 staging、backup 与 transaction manifest；失败只恢复真正完成的 operation，回滚失败保留证据并返回 `PLUGIN_TRANSACTION_REPAIR_REQUIRED`。
- Plugin 创建的内容根和嵌套目录写入 state directory ownership；预先存在的用户目录不认领。remove 先校验目录 canonical tree hash，再按文件、深层目录、浅层目录顺序清理，并保留未认领的共享平台根。
- 非 Skill 内容还会认领 `.flower/content/<canonical-id>` 与 kind 父目录，确保卸载后不残留 Plugin 专属空目录；共享 `.flower/content` 根不认领。
- `PluginApplicationService` 是 list/add/update/remove/verify 唯一用例入口；remove 从新图计算 orphan，只删除旧 state 归属且当前 hash 仍匹配的路径。
- `verify` 双向检查声明与 lock roots、lock 可达性、lock 与 state Plugin 集合、跨 Plugin 路径 ownership、固定包摘要以及文件/目录目标 hash；只报告诊断，不自动修复。
- CLI JSON 成功与失败都固定包含 `ok`、`command`、`changes`、`diagnostics`；退出码 `2` 表示用法或平台选择错误，`3` 表示验证/解析/内容冲突，`1` 表示 I/O、状态损坏或事务执行失败。
- state 已成功写入后若事务目录清理失败，不能回滚已确认成功的变更；writer 返回 `cleanup.status=retained`，应用层输出 warning 和项目内相对证据路径。
- dry-run 复用完整解析、投影、planner 和 writer preflight，但不创建 `.flower/`。

## 6. 后续任务边界

- P3：注册 GitLab Provider，并在不泄露 token/缓存绝对路径的前提下接入 CLI source/auth/search。
- P4：在 resolver 能力注入和 `InstallPlan.patchMutations` 上实现授权与 Patch preflight。
- P5：把 `flower/skill-garden` 包装为 builtin provider，并让现有 init/update facade 调用 Application Service；不能保留第二份成功 state。
- P6：作者工具生成的包必须能被 builtin/local provider 原样读取，并用本任务的 Runtime 做本地验证。
