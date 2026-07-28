# Flower Plugin 契约与 Project Store

## 目标

为 Flower Plugin Runtime 建立首个可执行、可版本化的基础契约，并实现独立于 `.trellis/` 的 `.flower/` Project Store。后续 Runtime、GitLab Provider、Capability Policy、内置 Plugin 迁移和作者工具必须复用本任务冻结的 schema、身份、摘要和状态 API，不得各自定义近似对象。

本任务是父任务 `07-28-flower-plugin-system` 的 P1，也是后续 P2、P3、P4 的共同前置任务。

## 已确认事实

- 项目使用 Node.js ESM，最低 Node.js 版本为 `18.17.0`，本期不引入 TypeScript 编译链。
- 现有 `src/lib/manifest.js` 将 Flower 状态写入 `.trellis/.flower-manifest.json`，不能支持无 Trellis 项目。
- 现有 `src/lib/fs-utils.js#copyPath()` 会先删除目标再整体覆盖，不适合作为 Plugin Project Store 或事务写入能力。
- 现有 Patch Engine 已实现 POSIX 相对路径校验、软链逃逸检查和 SHA-256 摘要；本任务应提炼可复用的通用基础能力，但不得改变 Patch selector 或应用语义。
- `.flower/plugins.json` 与 `.flower/plugin-lock.json` 是可提交的项目期望状态；`.flower/state.json`、缓存和事务目录只属于本机。
- Plugin canonical ID 固定为 `<source-id>/<plugin-id>`；Plugin 版本使用 SemVer，锁定结果必须落到不可变 commit 和 canonical tree hash。

## 需求

### R1. Plugin Manifest v1

- 定义并校验 `.flower-plugin/plugin.json` 的 `schemaVersion: 1` 契约。
- 必填字段至少包含 `id`、`name`、`version`、`compatibility`、`capabilities` 和 `content`。
- `id` 使用小写连字符格式；manifest 内只保存 local Plugin ID，全局 canonical ID 由来源和 local ID 组合。
- `version` 必须是有效 SemVer；兼容范围和依赖约束必须是有效 SemVer range。
- `dependencies` 的键必须是 canonical Plugin ID，不能隐式依赖 `flower/skill-garden`。
- `content` 只允许声明受支持目录和安全 POSIX 相对路径；拒绝绝对路径、反斜杠、空片段、`.`、`..` 和路径逃逸。
- v1 不提供 install、update、remove lifecycle hook 字段；`scripts/` 只能作为被动资源声明。
- 外部 manifest 可以请求 `standard` 或 `integration`，但 schema 层不得把请求解释为最终授权；`system` 的信任判定留给 P4。
- 未知字段默认拒绝，避免拼写错误或旧 Runtime 静默忽略安全相关字段。

### R2. Marketplace Manifest v1

- 定义并校验 `.flower-marketplace/marketplace.json` 的 `schemaVersion: 1` 契约。
- Marketplace 条目支持共仓 `path` 来源和 GitLab `gitlab` 来源，两种来源输出相同的 Plugin candidate 结构。
- 每个可安装版本必须包含 SemVer、固定 ref、不可变 commit 和 `sha256:` canonical tree hash。
- Marketplace 只声明 `maxProfile` 能力上限，不保存项目批准结果，也不能授予 `system`。
- GitLab project path、可选 subdir 和共仓 path 都必须经过安全路径与标识校验。
- 同一 Marketplace 内 Plugin ID 和同一 Plugin 的版本号不得重复。

### R3. 项目文件 schema v1

- 定义 `.flower/plugins.json`：只保存用户直接声明的 Plugin、来源和版本约束，不保存传递依赖、token、绝对路径或平台检测结果。
- 定义 `.flower/plugin-lock.json`：保存完整依赖图、来源、不可变 commit、canonical digest、兼容结论和 capability approval 摘要。
- 定义 `.flower/state.json`：保存本机实际投影平台、目标路径、内容 hash、Patch provenance、事务版本和所有权信息。
- 三类文件都必须包含独立的 schema version，并由同一错误模型返回精确 JSON path。
- lockfile 的序列化结果必须稳定；相同逻辑数据重复写入不得产生 diff。
- lockfile 不得包含当前机器检测到的平台、缓存路径、OAuth token、refresh token 或用户身份。

### R4. 共享身份与 DTO 契约

- 定义并导出后续子任务复用的 JSDoc 类型与运行时校验入口，包括：
  - `PluginManifest`
  - `MarketplaceManifest`
  - `SourceDescriptor`
  - `PluginCandidate`
  - `ResolvedPlugin`
  - `ResolvedGraph`
  - `CapabilityRequest`
  - `CapabilityGrant`
  - `ContentMutation`
  - `PatchMutation`
  - `InstallPlan`
  - `PluginLock`
  - `PluginState`
- DTO 必须区分来源输入、解析结果、安装计划和持久化状态，不能用一个宽泛对象跨层传递。
- 公共类、工厂和 public function 必须补齐中文 JSDoc，说明参数、返回值和错误。
- 统一错误模型至少区分 schema 无效、不安全路径、摘要不匹配、状态损坏和 I/O 失败，并提供稳定错误码。

### R5. Canonical JSON 与 Tree Hash

- 实现稳定 JSON 序列化：对象键递归排序，数组保持声明顺序，使用两个空格缩进并以换行结尾。
- 拒绝非 JSON 值、循环引用和非有限数字，不能依赖普通 `JSON.stringify()` 的偶然对象插入顺序作为锁文件契约。
- canonical tree hash 必须覆盖 Plugin 根目录下全部普通文件，包括 manifest、skills、patches、assets、scripts 和 tests。
- tree hash 按 POSIX 相对路径字节序稳定排序，并使用带长度边界的路径与文件内容编码计算 SHA-256，避免不同文件组合产生歧义。
- 摘要遍历拒绝软链和非普通文件；不得跟随软链读取 Plugin 根目录之外的内容。
- 相同文件树在不同临时目录和不同遍历顺序下必须得到相同摘要；文件路径或字节变化必须改变摘要。

### R6. `.flower/` Project Store

- 首次初始化创建 `.flower/` 和局部 `.flower/.gitignore`，不修改项目根 `.gitignore`，也不创建 `.trellis/`。
- `.flower/.gitignore` 至少忽略 `state.json`、`cache/`、`transactions/` 和 `*.tmp`。
- Project Store 提供 plugins、lock、state 的独立读写入口，并在读写边界执行 schema 校验。
- 文件不存在时返回明确的空状态或默认值；JSON 损坏、schema 不匹配或版本未知时必须返回结构化错误，不能静默重置或覆盖原文件。
- 每个 JSON 文件使用同目录临时文件加原子 rename 完成单文件替换；临时文件名不得包含敏感数据。
- 写入前计算 canonical 内容；内容未变化时不重写文件。
- 写入失败时保留原文件并清理本次临时文件；本任务不承诺 plugins、lock、state 三文件之间的跨文件事务。
- 所有 Project Store 路径必须固定在目标项目 `.flower/` 边界内，并拒绝项目根或 `.flower/` 经软链逃逸。

### R7. 兼容与边界

- 本任务不改写现有 `.trellis/.flower-manifest.json`，也不执行旧 manifest 迁移；迁移由 P5 消费本任务 schema 和 store API 实现。
- 本任务不实现依赖求解、Source Registry、GitLab/OAuth、Capability negotiation、内容投影、Patch 应用或 CLI 命令。
- 本任务可以为 schema 校验和 SemVer 解析增加直接运行时依赖，但必须在 `package.json` 中显式声明，并由 P7 复核最终打包。
- 不复制 Patch Engine 的 selector 或 Patch 变换实现；若提取路径或摘要 helper，只允许做无业务语义的通用复用，并保持现有 Patch Engine 测试通过。

## 验收标准

- [ ] Plugin Manifest v1、Marketplace Manifest v1、plugins/lock/state v1 均有有效与无效 fixture 测试。
- [ ] schema 测试覆盖未知字段、非法 ID、非法 SemVer/range、不安全路径、重复 Marketplace 版本和未知 schema version。
- [ ] 所有共享 DTO 与公共运行时入口均有完整中文 JSDoc，后续子任务可直接导入。
- [ ] 稳定 JSON 对对象键顺序不敏感，对数组顺序敏感，重复序列化字节完全一致。
- [ ] canonical tree hash 在不同创建顺序和不同根目录下保持一致，并拒绝软链、特殊文件和路径逃逸。
- [ ] Project Store 可在没有 `.trellis/` 的普通项目中初始化，仅创建 `.flower/` 边界。
- [ ] `.flower/.gitignore` 精确覆盖本机状态、缓存、事务和临时文件，不修改根 `.gitignore`。
- [ ] 缺失文件、损坏 JSON、schema 不匹配、未知版本和 I/O 失败均产生确定结果，损坏文件不会被自动覆盖。
- [ ] 单文件写入使用同目录临时文件与 rename；模拟写入失败后原文件字节不变且无残留临时文件。
- [ ] 相同数据重复写入不改变 mtime 或文件内容，稳定 lockfile 不产生无意义 diff。
- [ ] `node --test test/js/plugin-*-schema.test.js test/js/plugin-project-store.test.js test/js/plugin-integrity.test.js` 通过。
- [ ] 现有 Patch Engine 与完整 `npm test` 回归通过。

## 非目标

- 不实现 Plugin add、update、remove、verify 或 source/auth 命令。
- 不下载、解压或缓存远端 Plugin。
- 不解析依赖闭包或决定最终 capability grant。
- 不应用 Plugin 内容或 Patch，不实现跨文件事务。
- 不迁移或删除旧 `.trellis/.flower-manifest.json`。
