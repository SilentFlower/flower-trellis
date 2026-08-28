# Flower Plugin Contracts

> 本规范定义 Flower Plugin v1 的公共数据契约、完整性算法与 `.flower/` Project Store 边界。Runtime、GitLab Provider、Capability Policy、迁移和作者工具必须导入这些实现，不得各自定义近似 schema、身份或摘要算法。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/contracts.js`、`errors.js`、`schemas/**`、`integrity/**`、`formats/**` 或 `state/project-store.js`。
- 新增或修改 Plugin/Marketplace manifest、`.flower/plugins.json`、`plugin-lock.json`、`state.json` 字段。
- Provider、Resolver、Installer、Patch capability 或迁移代码需要构造 `PluginCandidate`、`ResolvedPlugin`、`InstallPlan`、`PluginLock`、`PluginState`。
- 改变 canonical ID、SemVer、commit、digest、路径安全、tree hash 或原子写入语义。

本规范不定义依赖求解、OAuth、Capability 授权算法、内容投影、Patch 变换或多文件事务；这些层只能消费这里的契约。

## 2. Signatures

```js
validatePluginManifest(value) -> PluginManifest
validateMarketplaceManifest(value) -> MarketplaceManifest
validateSourceDescriptor(value) -> GitLabSourceDescriptor | GitHubSourceDescriptor
validateGitHubSourceDescriptor(value) -> GitHubSourceDescriptor
createEmptyPluginsFile() -> ProjectPluginsFile
validatePluginsFile(value) -> ProjectPluginsFile
validatePluginLock(value) -> PluginLock
validatePluginState(value) -> PluginState

stringifyCanonicalJson(value) -> string
listCanonicalTreeFiles(root) -> Array<{path, absolutePath, size}>
hashCanonicalTree(root) -> "sha256:<64 lowercase hex>"

new ProjectStore(projectRoot, { fileSystem?, randomBytes? })
ProjectStore.ensureLayout() -> {flowerDir, gitignorePath, status}
ProjectStore.readPlugins() -> ProjectPluginsFile
ProjectStore.writePlugins(value) -> {status, path}
ProjectStore.readLock() -> PluginLock | null
ProjectStore.writeLock(value) -> {status, path}
ProjectStore.readState() -> PluginState | null
ProjectStore.writeState(value) -> {status, path}
```

共享 JSDoc DTO 的唯一来源是 `src/plugin/contracts.js`。公共 validator 的唯一来源是 `src/plugin/schemas/**`，调用方不得复制正则或手写“近似校验”。

## 3. Contracts

### Identity And Version

- local Plugin/source ID：单段小写字母、数字和连字符，不能以连字符开头或结尾。
- canonical Plugin ID：`source-id/plugin-id`，只允许一个 `/`。
- 项目声明的 `source`、锁文件 `source.id` 必须等于 canonical ID 的 `source-id`。
- `version` 使用严格 SemVer；`v1.2.3` 不合法。兼容性和依赖使用 `semver` 的有效 range。
- Git commit 是 40 位十六进制；digest 是 `sha256:` 加 64 位小写十六进制。
- 安全路径必须是 POSIX 相对路径，同时拒绝 POSIX/Windows 绝对路径、反斜杠、空片段、`.` 和 `..`。

### Manifest And Marketplace

- Plugin Manifest v1 必含 `schemaVersion`、`id`、`name`、`version`、`compatibility`、`capabilities`、`content`。
- `content` 只允许 `skills/specs/assets/scripts/tests`；`scripts` 是被动资源，v1 没有 lifecycle hook。
- `content.skills` 固定为 `{name,path,version,description?}` 对象数组：`name` 是 TUI/selection 使用的单段 Skill 名称，`path` 是包内来源路径，`version` 是该 Skill 自己的严格 SemVer。字符串路径数组不合法，不做旧 manifest 兼容。
- `patches` 只声明 `catalog` 与可选 `bundles`；schema 请求不等于最终能力授权。
- Marketplace v1 source 允许共仓 `path`、远程 `gitlab` 或公开 `github`；GitHub source 固定使用规范化的 `owner/repository` 与可选安全 `subdir`。source 可声明安全相对 `manifestPath` 指向非包根 manifest，例如仓库根 `.flower-plugin/plugin.json`；共仓 `type:"path"` 可省略 `path` 表示从当前仓库根按 manifest 声明构建运行时包。
- 每个 Marketplace 版本必须同时包含 SemVer、`ref`、不可变 `commit` 和 canonical tree `integrity`。
- Marketplace `trust.maxProfile` 只能是 `standard` 或 `integration`，不能授予 `system`。
- Marketplace Plugin ID 和同一 Plugin 内的版本号必须唯一。

### Project Files

```text
.flower/
├── .gitignore
├── plugins.json       # 可提交：直接声明
├── plugin-lock.json   # 可提交：完整锁定图
├── state.json         # 本机状态，gitignored
├── cache/             # gitignored
└── transactions/      # gitignored
```

- `plugins.json` 只保存直接 Plugin、source ID、版本约束和可选显式平台限制。
- 直接 Plugin 可选 `contentSelection.skills`，表示按 manifest `content.skills[].name` 选择要安装的 Skill 子集；名称必须是非空单段安全名，不能含 `/`、`\`、`.` 或 `..`。该字段只属于直接声明，不由依赖继承。
- `plugin-lock.json` 保存完整图、source descriptor、commit、integrity、兼容范围和 capability grant；不得保存 token、用户身份、本机绝对路径或检测平台。
- `plugin-lock.json` 和 `state.json` 必须原样记录解析后实际生效的 `contentSelection`，用于 verify 检测声明、lock 和本机投影是否一致。
- resolved source 是判别式对象：`builtin.reference` 为包内稳定引用，`local.reference` 为安全 POSIX 相对路径，`gitlab.reference` 为 GitLab project path，`github.reference` 为规范化的 `owner/repository`。
- GitLab 锁定项必须同时包含 Plugin `commit` 与 Marketplace `source.indexCommit`。
- GitHub 锁定项必须固定 `format` 与 `entryPath`；通过 Marketplace 发现时还必须成对保存 `indexReference/indexCommit`，直连 Plugin 不得伪造索引字段。
- 用户级 `plugin-sources.json` schemaVersion 3 以 `type=gitlab|github` 判别自定义来源，并允许内置来源 `{id,enabled}` 偏好。schemaVersion 1/2 继续兼容旧 descriptor；与内置 ID 重名的旧完整记录只继承 `enabled`，下一次写入原子压缩为 v3 偏好，不能覆盖随包连接定义。v1 中出现 GitHub 必须拒绝。
- GitHub 来源草稿可省略 `ref`，Provider 必须先解析仓库默认分支，再把实际 ref 写入持久化 descriptor；已保存 descriptor 的 `ref` 必填。`format=auto` 与 `entryPath` 互斥，确认格式后必须同时固定非 `auto` format 与安全 `entryPath`。
- `state.json` 保存实际平台、路径 hash/ownership、Patch operation/target/result hash、事务版本和可选迁移来源。
- 缺失 `plugins.json` 返回 `{schemaVersion: 1, plugins: []}`；缺失 lock/state 返回 `null`。损坏 JSON、未知版本或 schema 无效不能被当作缺失覆盖。

### Canonical Bytes And Storage

- Canonical JSON 递归排序对象键、保留数组顺序、使用两个空格缩进，并以一个换行结尾。
- Canonical JSON 拒绝 `undefined`、函数、symbol、bigint、循环引用和非有限数字。
- Tree hash 收集全部普通文件，按 UTF-8 POSIX 相对路径字节排序；每项编码为 4 字节大端路径长度、路径、8 字节大端内容长度、内容。
- Tree hash 不包含绝对根、遍历顺序、mtime、权限位或压缩包字节；根软链、内部软链和特殊文件必须失败。
- `ProjectStore` 读写前都验证项目根与既有 `.flower/` 边界；不得通过目录或受管文件软链读取/写入项目外。
- 写入先校验新值和既有文件，再比较 canonical 字节；相同内容返回 `unchanged`，不同内容使用同目录独占临时文件、`fsync`、close、rename。
- write/close/rename 失败必须保留原文件并清理本次临时文件。P1 不承诺三类 JSON 之间的跨文件事务。

## 4. Validation & Error Matrix

| 条件 | 错误类型 / 结果 | 必须保持的证据 |
| --- | --- | --- |
| manifest 或项目文件结构/语义无效 | `PluginSchemaError` / `PLUGIN_SCHEMA_INVALID` | `issues[]` 含稳定 `code/path/message` |
| 绝对路径、危险片段、软链或边界逃逸 | `PluginPathError` / `PLUGIN_UNSAFE_PATH` | `path` 指向拒绝对象 |
| tree 根不是目录或出现特殊文件 | `PluginIntegrityError` / `PLUGIN_INTEGRITY_MISMATCH` | 不读取或写入边界外内容 |
| 已存在 JSON 损坏、schema 无效或版本未知 | `PluginStateError` / `PLUGIN_STATE_CORRUPT` | 原文件字节不变 |
| 文件系统读取、写入、同步、关闭、rename 或清理失败 | `PluginIoError` / `PLUGIN_IO_ERROR` | 原文件保留；可清理时无 `.tmp` 残留 |
| canonical/source ID 不一致 | schema issue `project.source-mismatch` 或 `lock.source-mismatch` | 不进入 Resolver/写盘 |
| GitLab lock 缺 commit/index commit | `lock.gitlab-commit-required` / `lock.index-commit-required` | 不产生可提交 lock |
| GitHub lock 缺 format/entryPath，或索引 identity 只出现一半 | `PLUGIN_SCHEMA_INVALID` | 不产生可提交 lock |
| `contentSelection.skills` 名称非法、重复、为空或指向不存在的 manifest Skill | `PLUGIN_CONTENT_SELECTION_INVALID` | 不写入声明、lock、state 或目标 Skill |
| v1 source store 含 GitHub，或 `format=auto` 同时固定 entryPath | `PLUGIN_SOURCE_CONFIG_INVALID` | 原配置字节不变 |
| 重复 Marketplace Plugin/版本 | `marketplace.duplicate-plugin` / `marketplace.duplicate-version` | 精确指向重复条目 |
| 相同 canonical JSON 重复写入 | `{status: "unchanged"}` | 文件内容与 mtime 不变 |

## 5. Good / Base / Bad Cases

### Good

```json
{
  "schemaVersion": 1,
  "plugins": [
    { "id": "rd-guide/code-review", "source": "rd-guide", "version": "^1.2.0" }
  ]
}
```

GitLab resolved source 使用 `id=rd-guide`、`type=gitlab`、project path `reference` 和固定 `indexCommit`；Plugin 节点同时固定 `commit` 与 `integrity`。

### Base

- 普通项目没有 `.trellis/` 和 `.flower/`：`readPlugins()` 返回空声明；首次写入只创建 `.flower/`。
- Plugin 不需要 Trellis：省略 `compatibility.trellis`。
- 本地或内置 Plugin 没有 Git commit：`commit` 可以是 `null`，但仍需要 canonical tree `integrity`。
- GitHub 来源省略 ref：先解析仓库默认分支，再把实际 Plugin commit 与 tree integrity 写入候选和 lock。

### Bad

- `id=flower/sample`、`source=rd-guide`。
- `version=v1.2.3`、路径 `C:/outside` 或 `../outside`。
- local `reference=/tmp/plugin`，或 lock 中加入 `platforms`、token、用户字段。
- GitHub source store 使用 schemaVersion 1，或把未确认的 `format=auto` 与旧 `entryPath` 一起持久化。
- `.flower` 指向项目外目录的软链后调用任何 read/write 方法。
- 捕获损坏 JSON 后返回默认值并覆盖原文件。

## 6. Tests Required

- `plugin-manifest-schema.test.js`：有效 manifest；`content.skills` 对象 entry；旧字符串 Skill 条目拒绝；重复 Skill name/path；未知字段；严格 SemVer/range；canonical dependency；POSIX/Windows 不安全路径；未知 schema version。
- `plugin-marketplace-schema.test.js`：path/gitlab/github source、安全 subdir/manifestPath、共仓 path 省略、重复 Plugin/版本、未知来源、`system` 上限和 commit/digest 格式。
- `plugin-project-files-schema.test.js`：空声明；重复 ID；source mismatch；不安全 local reference；非法 capability；未知依赖；GitLab commit/index commit；state ownership/provenance。
- `plugin-source-store.test.js`：v1 GitLab 读取/写入升级、v1 GitHub 拒绝、GitHub URL 规范化、format/entryPath 联动和安全 subdir。
- `plugin-integrity.test.js`：对象键/数组顺序；非法 JSON 值；不同根和创建顺序同 hash；内容变化异 hash；根/内部软链和特殊文件失败。
- `plugin-project-store.test.js`：无 Trellis 初始化；局部 ignore 幂等；缺失/损坏状态；changed-only mtime；write/close/rename 故障；项目根、`.flower` 与受管文件软链失败。
- 修改本契约后必须运行 P1 定向测试、`test/js/patch-engine.test.js`、完整 `npm test`、`npm pack --dry-run --json` 与 `git diff --check`。

## 7. Wrong vs Correct

### Wrong

```js
// 下游模块复制一套较宽松的 ID/路径校验，并直接读取 JSON。
const lock = JSON.parse(fs.readFileSync(".flower/plugin-lock.json", "utf8"));
if (lock.plugins) useLock(lock);
```

这种写法会绕过 schema version、source identity、软链边界和损坏状态保护，并让不同 Provider 产生不兼容对象。

### Correct

```js
import { ProjectStore } from "./state/project-store.js";
import { validatePluginManifest } from "./schemas/plugin-manifest.js";

const manifest = validatePluginManifest(rawManifest);
const lock = new ProjectStore(projectRoot).readLock();
```

Provider、Resolver 和 Installer 只构造 `contracts.js` 定义的 DTO，并在来源、计划或持久化边界调用同一 validator；修改字段或哈希协议时先更新 P1 契约与全部消费者测试。

外部 Claude Code、Codex 或 skill-only manifest 也不得直接进入 Resolver。格式 Adapter 必须先生成通过 `validatePluginManifest()` 的标准 Flower package，再计算 canonical tree hash；上游任意字段只允许进入非敏感兼容诊断，不能原样写入 lock。
