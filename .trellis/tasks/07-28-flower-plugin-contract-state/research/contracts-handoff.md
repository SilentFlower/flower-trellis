# P1 契约交接：Flower Plugin Contract v1

本文冻结 P1 已实现的共享边界，供 P2 Runtime、P3 GitLab Marketplace 与 P4 Patch Capability 直接引用。后续任务应复用这些 validator、DTO 和错误类型，不在各自模块内复制或放宽规则。

## 1. 稳定入口

| 领域 | 文件 | 公共入口 |
| --- | --- | --- |
| 错误模型 | `src/plugin/errors.js` | `PLUGIN_ERROR_CODES`、`PluginError` 及五个领域错误子类 |
| DTO | `src/plugin/contracts.js` | `PLUGIN_CONTRACT_VERSION` 与共享 JSDoc typedef |
| 公共规则 | `src/plugin/schemas/shared.js` | Plugin ID、canonical ID、SemVer、commit、digest、POSIX 相对路径校验 |
| Plugin Manifest | `src/plugin/schemas/plugin-manifest.js` | `PLUGIN_MANIFEST_SCHEMA`、`validatePluginManifest()` |
| Marketplace | `src/plugin/schemas/marketplace-manifest.js` | `MARKETPLACE_MANIFEST_SCHEMA`、`validateMarketplaceManifest()` |
| 项目文件 | `src/plugin/schemas/project-files.js` | 三类 schema、三个 validator、`createEmptyPluginsFile()` |
| 完整性 | `src/plugin/integrity/canonical-json.js` | `stringifyCanonicalJson()` |
| 文件树摘要 | `src/plugin/integrity/canonical-tree.js` | `listCanonicalTreeFiles()`、`hashCanonicalTree()` |
| 项目存储 | `src/plugin/state/project-store.js` | `ProjectStore` |

## 2. 身份与来源约束

- 本地 Plugin ID 使用单段小写连字符格式；跨 Marketplace 的 canonical ID 使用 `source-id/plugin-id`。
- 依赖键、项目声明 ID、锁文件 root 和 resolved Plugin ID 都必须是 canonical Plugin ID。
- 严格 SemVer 不接受 `v1.2.3` 等前缀写法；安全 POSIX 相对路径同时拒绝 POSIX 与 Windows 绝对路径。
- Marketplace source 仅支持共仓 `path` 与远程 `gitlab` 两种描述。
- Marketplace 条目的 `trust.maxProfile` 只能是 `standard` 或 `integration`，不能授予 `system`。
- Marketplace 版本必须同时固定 `version`、`ref`、40 位 Git commit 和 `sha256:<64 hex>` integrity。
- GitLab 锁定结果必须同时保留 Plugin `commit` 与 Marketplace `source.indexCommit`。
- resolved source 使用判别式 descriptor：`builtin.reference` 是包内稳定引用，`local.reference` 是安全 POSIX 相对路径，`gitlab.reference` 是 GitLab project path；descriptor 的 source ID 必须与 canonical Plugin ID 前缀一致。

## 3. Manifest 与能力契约

Plugin Manifest v1 必填字段为：

- `schemaVersion`、`id`、`name`、`version`
- `compatibility.flower`，可选 `compatibility.trellis`
- `capabilities.profile` 与 `capabilities.required`
- 至少包含一个已知键的 `content`

`content` 当前只接受 `skills`、`specs`、`assets`、`scripts`、`tests`，值均为唯一、安全的 POSIX 相对路径数组。Patch 声明只接受 `patches.catalog` 与可选 `patches.bundles`；具体能力授权由 P4 实现，P1 不根据声明自动授权。

共享 DTO 已冻结：`CapabilityRequest`、`CapabilityGrant`、`PluginManifest`、`MarketplaceManifest`、`SourceDescriptor`、`PluginCandidate`、`ResolvedPlugin`、`ResolvedGraph`、`ContentMutation`、`PatchMutation`、`InstallPlan`、`PluginLock`、`PluginState`。

## 4. 项目文件边界

- `.flower/plugins.json`：用户直接声明，缺失时由 `ProjectStore.readPlugins()` 返回 `{ "schemaVersion": 1, "plugins": [] }`。
- `.flower/plugin-lock.json`：完整 resolved graph；不得写入 token、用户身份、本机绝对路径或当前平台检测结果。
- `.flower/state.json`：本机实际应用状态，记录平台、路径 ownership、内容摘要和 Patch provenance；该文件由局部 `.gitignore` 忽略。
- `.flower/.gitignore` 必含 `state.json`、`cache/`、`transactions/`、`*.tmp`，同时保留用户已有规则。

`ProjectStore` 对三类 JSON 执行 schema 校验、canonical JSON changed-only 写入、同目录临时文件、`fsync` 和原子 rename。旧文件损坏时普通写入必须失败，不能把损坏状态当作缺失覆盖。读写入口都会先校验项目根与既有 `.flower/`；项目根、`.flower/`、本机目录与受管文件均拒绝软链边界逃逸。

## 5. Canonical tree hash

`hashCanonicalTree(root)` 的输入模型固定为：

1. 递归收集普通文件，拒绝根软链、内部软链和特殊文件。
2. 路径转为安全 POSIX 相对路径，按 UTF-8 路径字节升序排列。
3. 每个文件依次写入 4 字节大端路径长度、路径字节、8 字节大端内容长度、内容字节。
4. 对整个字节流计算 SHA-256，返回 `sha256:<hex>`。

摘要不包含绝对根路径、目录创建顺序、mtime、权限位或压缩包字节。P3 下载后必须对解出的 Plugin 根目录调用同一实现；P2 解析本地/内置来源也使用同一实现。

## 6. 错误码

| 错误码 | 类型 | 使用场景 |
| --- | --- | --- |
| `PLUGIN_SCHEMA_INVALID` | `PluginSchemaError` | 外部 manifest 或待写项目文件不符合契约 |
| `PLUGIN_UNSAFE_PATH` | `PluginPathError` | 路径非法、软链或边界逃逸 |
| `PLUGIN_INTEGRITY_MISMATCH` | `PluginIntegrityError` | 内容树或完整性边界不满足 |
| `PLUGIN_STATE_CORRUPT` | `PluginStateError` | 已存在项目状态 JSON 损坏或 schema 无效 |
| `PLUGIN_IO_ERROR` | `PluginIoError` | 文件系统读写、原子替换或清理失败 |

所有 schema 错误通过 `issues` 暴露稳定的 `code`、JSON Pointer `path` 和中文 `message`，调用方不得依赖 Ajv 原始错误对象。

## 7. 下游任务使用规则

- P2：以 `PluginCandidate -> ResolvedPlugin -> ResolvedGraph -> InstallPlan` 为主链，输出必须通过项目文件 validator 后再交给 `ProjectStore`。
- P3：远程索引先调用 `validateMarketplaceManifest()`；下载内容调用 `validatePluginManifest()` 和 `hashCanonicalTree()`；token 仅进入认证请求，不进入任何 schema 对象。
- P4：能力决策读 `CapabilityRequest`，输出 `CapabilityGrant`；Patch 计划使用 `PatchMutation`，状态落盘沿用 `PluginState.patches`。
- 如需改变字段、错误码、哈希算法或路径语义，必须回到 P1 契约任务统一修改并补充兼容性测试，不能在下游私自扩展。
