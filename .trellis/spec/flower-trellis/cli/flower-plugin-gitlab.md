# Flower Plugin GitLab Sources

> 本规范定义 Flower Plugin v1 的 GitLab Marketplace、OAuth、系统凭据和远程缓存边界。P1 的 manifest、lock、canonical tree hash 与 Project Store 契约仍以 [Flower Plugin Contracts](./flower-plugin-contracts.md) 为唯一来源。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/auth/**`、`src/plugin/gitlab/**`、`src/plugin/sources/gitlab-provider.js`、`user-source-store.js` 或 `src/builtin-marketplaces/*.json`。
- 修改 `plugin source`、`plugin auth`、`plugin search` 或远程 `plugin add/update/verify/remove` 的接入方式。
- 改变 OAuth scope、公共客户端参数、Keyring 降级、GitLab REST 端点、archive 解包、远程缓存键或敏感信息输出边界。

GitLab Provider 只负责来源认证、索引和固定包准备；依赖求解、内容写盘和项目事务必须继续交给 Plugin Runtime/Application Service。

## 2. Signatures

```text
flower-trellis plugin source add|list|remove|update|enable|disable [source-id] [options]
flower-trellis plugin auth login|logout|status [source-id] [--device] [--json]
flower-trellis plugin search [query] [--source source-id] [--json]
```

```js
flowerConfigDirectory(env?) -> string
validateGitLabSourceDescriptor(value) -> GitLabSourceDescriptor
new UserSourceStore({ configFile?, builtinDescriptors? })
UserSourceStore.list() -> GitLabSourceDescriptor[]
UserSourceStore.get(id, { includeDisabled? }) -> GitLabSourceDescriptor
UserSourceStore.set(source) -> GitLabSourceDescriptor
UserSourceStore.remove(id) -> boolean
UserSourceStore.setEnabled(id, enabled) -> GitLabSourceDescriptor

createCredentialStore({ loadKeyring?, memoryStore? }?)
  -> Promise<{ store: CredentialStore, persistent: boolean }>
CredentialStore.get(source) -> Promise<Credential|null>
CredentialStore.set(source, credential) -> Promise<void>
CredentialStore.delete(source) -> Promise<void>

GitLabOAuthClient.loginWithPkce(source) -> Promise<Credential>
GitLabOAuthClient.loginWithDevice(source, { onVerification?, signal? }?) -> Promise<Credential>
GitLabOAuthClient.refresh(source, credential) -> Promise<Credential>
GitLabCredentialManager.getAccessToken(source) -> Promise<string>

GitLabRestClient.resolveCommit(project, ref) -> Promise<string>
GitLabRestClient.readRawFile(project, filePath, ref) -> Promise<string>
GitLabRestClient.readTree(project, { path?, ref }) -> Promise<object[]>
GitLabRestClient.downloadArchive(project, commit) -> Promise<Buffer>

GitLabSourceProvider.prepareIndex() -> Promise<MarketplaceManifest>
GitLabSourceProvider.prepare(canonicalId) -> Promise<void>
GitLabSourceProvider.prepareLocked(plugin) -> Promise<void>
GitLabSourceProvider.search(query?) -> Promise<object[]>
GitLabSourceProvider.listCandidates(canonicalId) -> PluginCandidate[]
GitLabSourceProvider.readPackage(plugin) -> { root, manifest, integrity }
```

## 3. Contracts

### Source And Credential

- 用户配置文件是 XDG 配置目录下的 `flower-trellis/plugin-sources.json`；Windows 有 `APPDATA` 时使用该目录。父目录权限为 `0700`，临时文件和配置文件权限为 `0600`，同目录 rename 提交。
- GitLab source descriptor 固定字段为 `schemaVersion/id/type/name/enabled/baseUrl/project/ref/marketplacePath/oauth`。`oauth` 只允许 `applicationId/scopes`；固定 scopes 为排序后的 `read_api`、`read_repository`。
- `baseUrl` 只允许无用户名密码的 `http:` 或 `https:`；`project` 是 GitLab project path，`marketplacePath` 是安全 POSIX 相对路径。
- source 配置禁止 `accessToken/refreshToken/token/clientSecret/applicationSecret` 以及其它未知字段。内置 `rd-guide` 只是随包 descriptor；仅 `list/get` 不构造客户端、不登录、不访问网络。
- Keyring service 固定为 `flower-trellis`，account 固定为 `<lowercase-host>[:port]/<source-id>`。凭据载荷固定包含 `schemaVersion/sourceId/baseUrl/tokenType/scope/accessToken/refreshToken/createdAt/expiresAt/redirectUri`。
- `@napi-rs/keyring` 是 optional dependency。模块缺失或系统后端运行失败时只能切换到当前进程的 `MemoryCredentialStore`，并令 `persistent=false`；凭据 JSON 损坏或 scope 无效必须直接报错，不能静默降级。

### OAuth And REST

- GitLab OAuth 是无 Application Secret 的公共客户端。浏览器登录使用 Authorization Code + PKCE S256、随机 state/verifier、`127.0.0.1` 随机端口和 `/oauth/callback`；Windows 直接调用 `explorer.exe`，不得经过 shell。
- PKCE callback 只接受一次预期路径的 GET，并同时校验 state 和 code。浏览器打开失败、callback 超时或无效回调必须关闭 server；返回页面不得显示 code 或 token。
- PKCE 仅在浏览器无法打开、callback server 无法监听或 callback 超时时允许降级到 Device Flow；state/code/token/scope 校验失败属于终止性认证错误，调用方不得静默降级。
- Device Flow 使用 `/oauth/authorize_device` 和 device-code grant；`authorization_pending` 保持轮询，`slow_down` 每次增加 5 秒，拒绝、过期和 `AbortSignal` 取消均终止。
- OAuth POST 与 `/oauth/token/info` 请求默认 30 秒超时；Device Flow 的外部 `AbortSignal` 必须同时取消等待和正在进行的请求，取消后不得再发起下一次 token 轮询。
- token response 未携带完整 scope 时必须调用 `/oauth/token/info` 验证实际授权。缺少 `read_api` 或 `read_repository` 时拒绝凭据。
- access token 在到期前 60 秒刷新；同一 source 并发刷新共享一个 Promise。refresh 失败必须尽力删除旧凭据，并统一返回 `PLUGIN_AUTH_REQUIRED`。
- REST 请求只使用 `Authorization: Bearer`，project path 和仓库文件路径分别做 URL 编码；token 不得进入 URL、argv、项目文件、缓存元数据或普通输出。
- REST 超时默认 30 秒；GET 网络错误或 5xx 最多重试一次，4xx 不重试。archive 默认最大 100 MiB，并同时检查 `content-length` 与实际响应字节。

### Marketplace And Cache

- 首次准备先把 source `ref` 解析为 40 位 commit，再在该 commit 读取并验证 Marketplace。Marketplace ID 必须等于 source ID。
- candidate 的 GitLab `source.reference` 只保存 project path，`source.indexCommit` 保存索引 commit；Plugin 自身同时固定 `commit` 和 `integrity`。
- archive 仅允许普通目录和普通文件，拒绝绝对路径、反斜杠、空片段、`.`、`..`、软链、硬链和特殊文件；单条目、总条目、总解压字节及目标 subdir 均受限。
- 解包后的 Plugin 根必须通过 manifest 校验和 P1 canonical tree hash。缓存键绑定 `baseUrl/project/commit/subdir/integrity`；metadata 绑定 `sourceId/baseUrl/project/commit/subdir/integrity`，不得包含 token、header 或用户身份。
- 缓存命中仍须复核 tree hash、manifest ID 和版本。损坏缓存只删除对应不可变缓存项并重新下载，不修改 lock。`prepareLocked()` 只能接受 lock 的 `indexCommit/version/commit/integrity/reference` 与锁定 Marketplace 完全一致的条目。
- `prepareLocked()` 只表示旧 lock 的固定包已经可重放，可以向候选集合登记锁定版本，但不得把 canonical ID 标记为“最新 Marketplace 已准备”。显式远程 `plugin update` 必须在恢复旧 lock 后继续执行 `prepare()`，重新解析 source `ref`、读取当前索引并加载新版候选；Provider 应使用独立的 prepared 状态，不能用 `candidates.has(id)` 兼任索引准备标记。
- `plugin source list`、`plugin auth status` 和未引用远程 source 的本地生命周期保持零网络。远程 add/update 只负责异步准备 Provider，最终解析和写盘复用 `PluginApplicationService`。

## 4. Validation & Error Matrix

| 条件 | 错误 / 结果 |
| --- | --- |
| source 含 secret、未知字段、非法 URL/project/path 或错误 scopes | `PLUGIN_SOURCE_CONFIG_INVALID`，不覆盖原配置 |
| source 配置 JSON 损坏、版本错误或 ID 重复 | `PLUGIN_SOURCE_CONFIG_INVALID`，原文件保持不变 |
| source 不存在或已禁用 | `PLUGIN_SOURCE_NOT_FOUND`，不触发认证或网络 |
| 没有凭据 | `PLUGIN_AUTH_REQUIRED` |
| scope 缺失、Keyring payload 损坏或来源身份不匹配 | `PLUGIN_AUTH_SCOPE_INVALID`，不得退回内存掩盖损坏 |
| 浏览器打开、callback 监听或 callback 超时失败 | `PLUGIN_AUTH_FAILED` 且标记允许 Device Flow 降级，关闭临时 callback 状态 |
| OAuth 请求超时/取消，或 state、code、token、scope 校验失败 | `PLUGIN_AUTH_FAILED`，不得自动降级，关闭临时 callback 状态 |
| refresh 失败 | 删除旧凭据并返回 `PLUGIN_AUTH_REQUIRED` |
| REST 超时、网络错误、4xx/5xx 或无效 JSON | `PLUGIN_REMOTE_REQUEST_FAILED`；5xx/网络最多重试一次 |
| archive 超限、危险条目或顶层结构无效 | `PLUGIN_REMOTE_ARCHIVE_INVALID`，不发布缓存 |
| manifest 身份、版本、trust 或 lock/index 不一致 | `PLUGIN_TARGET_DRIFT` 或来源配置错误，不进入 Runtime 写盘 |
| digest 不匹配 | P1 完整性错误包装为稳定 Runtime 错误，删除 staging/损坏缓存 |
| Keyring 不可用 | 使用进程内 store，`persistent=false`，不创建明文凭据文件 |
| `prepareLocked()` 已登记旧候选后执行显式远程 update | 仍须读取当前 Marketplace 并把满足约束的新版候选交给 Resolver；不得因旧候选存在而提前返回 |

## 5. Good / Base / Bad Cases

### Good

- 用户执行 `plugin auth login rd-guide`，PKCE 获取的实际 scopes 同时包含 `read_api/read_repository`，凭据进入系统 Keyring；随后 `plugin search --source rd-guide` 使用 Bearer REST 读取固定索引。
- 已锁定 Plugin 的 metadata、tree hash、manifest 身份全部匹配时，`prepareLocked()` 直接复用缓存，不访问 GitLab。
- 项目先锁定 `rd-guide/demo@1.0.0`，Marketplace 当前索引随后发布 `1.1.0`；显式 `plugin update rd-guide/demo` 先恢复 1.0.0 固定包，再读取新索引并由 Resolver 选择 1.1.0。

### Base

- 系统没有 Keyring：登录只在当前进程有效，`auth status --json` 输出 `persistent:false`，不生成 token 文件。
- 用户只执行本地 Plugin 命令或禁用 `rd-guide`：GitLab 请求数为 0。

### Bad

- 把 Application Secret 或 PAT 写入 source JSON、`.flower/plugin-lock.json`、命令参数或 cache metadata。
- 用 `read_repository` scope 失败后绕过 `repository/tree`，或申请具有写权限的完整 `api` scope。
- archive 解包后不校验 subdir、manifest 和 canonical tree hash就发布缓存。
- Keyring 返回损坏 JSON 时吞掉错误并切换到内存，让调用方误以为只是“未登录”。
- 把 `candidates.has(canonicalId)` 当作 `prepare()` 的幂等门禁；`prepareLocked()` 会先写入旧候选，导致显式远程 update 永远看不到新索引版本。

## 6. Tests Required

- `plugin-source-store.test.js`：内置 `rd-guide`、XDG/权限、启停与恢复、secret/未知字段/损坏 JSON、读取零网络。
- `plugin-credential-store.test.js`：版本化副本、Keyring 运行失败的内存降级、损坏 payload 不降级、递归脱敏。
- `plugin-oauth.test.js`：PKCE S256/state/一次性 callback/公共客户端、环境失败降级与认证失败不降级、OAuth 请求超时、Device pending/slow_down/请求中取消且不继续轮询、scope 验证、redirect URI refresh、并发单飞与 refresh 清理。
- `plugin-gitlab-rest-client.test.js`：Bearer、project/file 编码、commit/tree/files/archive、大小限制、超时和一次重试。
- `plugin-gitlab-provider.test.js`：index commit、candidate/lock 字段、不可变缓存、损坏重下、archive 链接/路径/限额、subdir、digest、manifest 身份和 trust 上限。
- `plugin-remote-cli.test.js`：source/auth/search 参数、非敏感 JSON、管理命令零网络、远程 add/update 复用 Application Service、自定义 local source ID 不误判为 GitLab。
- `plugin-e2e-gitlab.test.js`：真实 CLI 跨进程覆盖 Device Flow、PKCE、search、v1 add、切换 Marketplace 后的 v2 update、禁用零网络，以及 stdout/stderr/项目文件敏感值扫描；必须断言旧 lock 候选不会阻止当前索引准备。
- 修改本契约后必须运行上述定向测试、完整 `npm test`、`npm pack --dry-run --json`、敏感字段扫描与 `git diff --check`。

## 7. Wrong vs Correct

### Wrong

```js
const token = source.accessToken;
const url = `${source.baseUrl}/api/v4/projects/${source.project}?private_token=${token}`;
await fetch(url);
```

这会把凭据混入用户配置、URL 和诊断信息，并绕过统一 refresh、scope 验证、超时与错误分类。

### Correct

```js
const manager = new GitLabCredentialManager({ store, oauth });
const client = new GitLabRestClient({ source, credentialManager: manager });
const provider = new GitLabSourceProvider({ source, projectRoot, client });

await provider.prepare("rd-guide/code-review");
```

认证、只读请求和固定包准备分别由现有公共入口负责；Provider 产出 P1 DTO，项目写盘继续交给 Runtime/Application Service。

### Wrong: 用候选集合代替索引准备状态

```js
async prepare(canonicalId) {
  if (this.candidates.has(canonicalId)) return;
}
```

`prepareLocked()` 也会登记旧候选，因此这种门禁会让显式 update 在读取当前 Marketplace 前提前返回。

### Correct: 分离固定包恢复与当前索引准备

```js
if (this.preparedIds.has(canonicalId) || this.preparing.has(canonicalId)) return;
// ...当前 Marketplace 索引和该 Plugin 的全部版本完成校验与固定包准备...
this.candidates.set(canonicalId, candidates);
this.preparedIds.add(canonicalId);
```

锁定候选用于 lock-first 重放，`preparedIds` 只在当前索引候选完成加载后设置；两种状态不能互相替代。
