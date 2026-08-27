# Flower Plugin Remote Sources

> 本规范定义 Flower Plugin v1 的 GitLab Marketplace、GitHub 公共仓库、OAuth、远程格式探测和不可变缓存边界。文件名保留 GitLab 历史路径；P1 的 manifest、lock、canonical tree hash 与 Project Store 契约仍以 [Flower Plugin Contracts](./flower-plugin-contracts.md) 为唯一来源。

## 1. Scope / Trigger

以下改动必须先读本规范：

- 修改 `src/plugin/auth/**`、`src/plugin/gitlab/**`、`src/plugin/github/**`、`src/plugin/formats/**`、`src/plugin/sources/*-provider.js`、`remote-archive.js`、`user-source-store.js` 或 `src/builtin-marketplaces/*.json`。
- 修改 `plugin source`、`plugin auth`、`plugin search`、交互式来源管理器或远程 `plugin add/update/verify/remove` 的接入方式。
- 改变 OAuth scope、公共客户端参数、Keyring 降级、GitLab REST 端点、archive 解包、远程缓存键或敏感信息输出边界。

远程 Provider 只负责认证（如需要）、索引、固定快照和候选准备；格式 Adapter 负责检测与标准包归一化。依赖求解、内容写盘和项目事务必须继续交给 Plugin Runtime/Application Service。

## 2. Signatures

```text
flower-trellis plugin source add|list|remove|update|enable|disable [source-id] [options]
flower-trellis plugin auth login|logout|status [source-id] [--device] [--json]
flower-trellis plugin search [query] [--source source-id] [--json]

flower-trellis plugin source add <source-id>
  --type github --repo <owner/repository> [--ref <ref>]
  [--subdir <path>] [--format auto|flower|codex|claude-code|skill-only]
  [--entry-path <path>] [--json]
flower-trellis plugin source update <source-id> [--clear-subdir] [...]

Interactive source manager:
  来源 -> 新增来源 -> GitHub 公共仓库 | GitLab Marketplace | 返回来源 | 退出管理
  GitHub add: prompt <repository-url-or-owner/repository> only, then inspect -> ambiguity choice -> preview -> confirm -> source add
  GitLab add: prompt <project-url> only, then reuse known OAuth applicationId or ask for Application ID -> source add
  GitHub edit: prompt repository/ref/subdir/name, then reset format=auto -> inspect -> preview -> confirm -> source update
```

```js
flowerConfigDirectory(env?) -> string
validateGitLabSourceDescriptor(value) -> GitLabSourceDescriptor
validateGitHubSourceDescriptor(value) -> GitHubSourceDescriptor
validateSourceDescriptor(value) -> GitLabSourceDescriptor | GitHubSourceDescriptor
new UserSourceStore({ configFile?, builtinDescriptors? })
UserSourceStore.list() -> Array<GitLabSourceDescriptor | GitHubSourceDescriptor>
UserSourceStore.get(id, { includeDisabled? }) -> GitLabSourceDescriptor | GitHubSourceDescriptor
UserSourceStore.set(source) -> GitLabSourceDescriptor | GitHubSourceDescriptor
UserSourceStore.remove(id) -> boolean
UserSourceStore.setEnabled(id, enabled) -> GitLabSourceDescriptor | GitHubSourceDescriptor

createCredentialStore({ loadKeyring?, memoryStore? }?)
  -> Promise<{ store: CredentialStore, persistent: boolean }>
CredentialStore.get(source) -> Promise<Credential|null>
CredentialStore.set(source, credential) -> Promise<void>
CredentialStore.delete(source) -> Promise<void>

GITLAB_OAUTH_REQUEST_SCOPES -> ["openid", "profile", "read_user", "write_repository", "api"]
GITLAB_OAUTH_LEGACY_SCOPES -> ["read_api", "read_repository"]
isGitLabCredentialScopeSufficient(scopes) -> boolean
gitLabCredentialHost(source) -> string
parseGlabAuthStatusToken(output, source) -> string|null
resolveGitLabEnvironmentCredential(source, env?) -> ExternalCredential|null
new GitLabCredentialResolver({
  store, persistent?, env?, runGlab?, glabCommand?, glabTimeoutMs?,
})
GitLabCredentialResolver.resolve(source)
  -> Promise<{authorized,scopes,expiresAt,persistent,accessToken?,credentialSource?,credential?}>
GitLabCredentialResolver.resolveExternal(source) -> Promise<ExternalCredential|null>
GitLabCredentialResolver.status(source) -> Promise<{authorized,scopes,expiresAt,persistent}>
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

GitHubRestClient.resolveRepository(repository) -> Promise<{repository,defaultBranch}>
GitHubRestClient.resolveCommit(repository, ref?) -> Promise<{sha,committedAt}>
GitHubRestClient.downloadArchive(repository, commit) -> Promise<Buffer>

GitHubSourceProvider.inspect() -> Promise<GitHubInspection>
GitHubSourceProvider.prepare(canonicalId) -> Promise<void>
GitHubSourceProvider.prepareLocked(plugin) -> Promise<void>
GitHubSourceProvider.search(query?) -> Promise<object[]>
GitHubSourceProvider.listCandidates(canonicalId) -> PluginCandidate[]
GitHubSourceProvider.readPackage(plugin) -> { root, manifest, integrity }
```

## 3. Contracts

### Source And Credential

- 用户配置文件是 XDG 配置目录下的 `flower-trellis/plugin-sources.json`；Windows 有 `APPDATA` 时使用该目录。父目录权限为 `0700`，临时文件和配置文件权限为 `0600`，同目录 rename 提交。
- GitLab source descriptor 固定字段为 `schemaVersion/id/type/name/enabled/baseUrl/project/ref/marketplacePath/oauth`。`oauth` 只允许 `applicationId/scopes`；随包和新建 descriptor 的请求 scopes 为 `openid profile read_user write_repository api`，读取旧配置时继续接受排序后的 `read_api read_repository`。
- `baseUrl` 只允许无用户名密码的 `http:` 或 `https:`；`project` 是 GitLab project path，`marketplacePath` 是安全 POSIX 相对路径。
- source 配置禁止 `accessToken/refreshToken/token/clientSecret/applicationSecret` 以及其它未知字段。内置 `rd-guide` 的连接字段以随包 descriptor 为权威，用户层只允许保存 `enabled` 偏好；自定义连接必须使用新的 source ID。仅 `list/get` 不构造客户端、不登录、不访问网络。
- Keyring service 固定为 `flower-trellis`，account 固定为 `<lowercase-host>[:port]/<source-id>`。凭据载荷固定包含 `schemaVersion/sourceId/baseUrl/tokenType/scope/accessToken/refreshToken/createdAt/expiresAt/redirectUri`；凭据 scope 只要包含 `api`，或同时包含旧 `read_api` 与 `read_repository`，就满足当前 GitLab REST 读取能力。
- `@napi-rs/keyring` 是 optional dependency。模块缺失或系统后端运行失败时只能切换到当前进程的 `MemoryCredentialStore`，并令 `persistent=false`；凭据 JSON 损坏或 scope 无效必须直接报错，不能静默降级。
- GitLab 凭据解析链固定为 Flower Keyring OAuth、同 host `glab`、host 绑定环境/PAT fallback。`glab` 只能通过 `glab auth status --hostname <host> --show-token` 读取；捕获 stdout/stderr 后只提取同 host token，原始输出不得进入普通输出、诊断或持久化文件。环境 fallback 只接受 host 专属变量名如 `GITLAB_TOKEN_<HOST_KEY>` / `GLAB_TOKEN_<HOST_KEY>`，或 `GITLAB_TOKEN`、`GLAB_TOKEN`、`FLOWER_GITLAB_TOKEN` 与 `GITLAB_HOST`、`GLAB_HOST`、`FLOWER_GITLAB_HOST`、`CI_SERVER_HOST`、`CI_SERVER_URL` 中任一同 host 绑定值配对。未能证明同 host 时必须当作无凭据，不得猜测当前 Git remote。
- 外部 GitLab token 只允许在当前进程内交给 REST client 使用，`persistent=false`，`scopes=[]`，`expiresAt=null`；不得写入 Keyring、用户 source store、`.flower/`、lock、state、cache metadata、任务文件或普通输出。`plugin auth logout` 只删除 Flower Keyring 凭据，不能删除 `glab` 配置或环境变量；fallback 仍存在时后续 status 可以继续显示已登录。
- 用户 source store schemaVersion 3 同时接受 GitLab/GitHub descriptor 与内置来源 `{id,enabled}` 偏好；schemaVersion 1/2 继续兼容旧 descriptor。旧配置中与内置 ID 重名的完整 descriptor 只继承 `enabled`，不得覆盖随包连接字段；下一次写入原子压缩为 v3 偏好。schemaVersion 1 中出现 GitHub 必须报配置错误。
- GitHub 持久化 descriptor 固定字段为 `schemaVersion/id/type/name/enabled/repository/ref/subdir?/format/entryPath?`。`repository` 只保存无凭据的 `owner/repository`；命令草稿可省略 ref，但 inspect 必须解析默认分支并补齐后才能写入。`format=auto` 时不得保存 `entryPath`，固定格式时必须保存安全入口路径。
- `source update --clear-subdir` 显式删除旧 subdir；把 format 改回 `auto` 必须同时删除旧 entryPath，不能用 truthy fallback 让旧值复活。

### OAuth And REST

- GitLab OAuth 是无 Application Secret 的公共客户端。浏览器登录使用 Authorization Code + PKCE S256、随机 state/verifier、`127.0.0.1` 随机端口和 `/oauth/callback`；Windows 直接调用 `explorer.exe`，不得经过 shell。主动请求 scope 固定为 `openid profile read_user write_repository api`，不再请求旧的 `read_api read_repository`。
- PKCE callback 只接受一次预期路径的 GET，并同时校验 state 和 code。浏览器打开失败、callback 超时或无效回调必须关闭 server；返回页面不得显示 code 或 token。
- PKCE 仅在浏览器无法打开、callback server 无法监听或 callback 超时时允许降级到 Device Flow；state/code/token/scope 校验失败属于终止性认证错误，调用方不得静默降级。
- Device Flow 使用 `/oauth/authorize_device` 和 device-code grant；`authorization_pending` 保持轮询，`slow_down` 每次增加 5 秒，拒绝、过期和 `AbortSignal` 取消均终止。
- OAuth POST 与 `/oauth/token/info` 请求默认 30 秒超时；Device Flow 的外部 `AbortSignal` 必须同时取消等待和正在进行的请求，取消后不得再发起下一次 token 轮询。
- token response 未携带可接受读取能力时必须调用 `/oauth/token/info` 验证实际授权。实际授权包含 `api`，或同时包含旧 `read_api` 与 `read_repository` 时接受；仍不足时拒绝凭据。
- access token 在到期前 60 秒刷新；同一 source 并发刷新共享一个 Promise。refresh 失败必须尽力删除旧凭据，并统一返回 `PLUGIN_AUTH_REQUIRED`。
- REST 请求只使用 `Authorization: Bearer`，project path 和仓库文件路径分别做 URL 编码；token 不得进入 URL、argv、项目文件、缓存元数据或普通输出。携带凭据的请求必须禁用自动重定向，3xx 返回状态码、端点和目标 origin 的脱敏诊断；尤其不能让 HTTP→HTTPS 跳转静默剥离 Authorization 后再误报 404。
- REST 401 必须映射为 `PLUGIN_AUTH_REQUIRED`，REST 403 必须映射为 `PLUGIN_AUTH_SCOPE_INVALID`；TUI 和 CLI 管理视图据此展示未登录、重新登录或已登录语义，不得把认证失败包装成普通 Marketplace 加载失败。
- REST 超时默认 30 秒；GET 网络错误或 5xx 最多重试一次，4xx 不重试。archive 默认最大 100 MiB，并同时检查 `content-length` 与实际响应字节。只有 archive 对 OAuth 明确返回 406 时，Provider 才允许按同一固定 commit 和选中 subdir 递归读取 repository tree/raw 文件；其它 4xx 不回退。

### Marketplace And Cache

- 首次准备先把 source `ref` 解析为 40 位 commit，再在该 commit 读取并验证 Marketplace。Marketplace ID 必须等于 source ID。
- candidate 的 GitLab `source.reference` 只保存 project path，`source.indexCommit` 保存索引 commit；Plugin 自身同时固定 `commit` 和 `integrity`。
- archive 的全局危险路径必须一律拒绝：绝对路径、Windows 绝对路径、反斜杠、空片段、`.`、`..` 和条目总数超限都属于 `PLUGIN_REMOTE_ARCHIVE_INVALID`。总解压字节超限也必须失败，不能只跳过后续条目。
- archive 普通包内容只允许普通目录和普通文件。软链、硬链、特殊文件或单文件超限位于调用方显式选中的 `subdir` 内时必须失败；位于全仓扫描阶段的未选中目录或仓库根无关位置时允许跳过，避免公开仓库根目录的 `AGENTS.md`、文档 symlink 等无关条目误阻断格式检测。
- 解包后的规范化复制仍必须使用 ordinary-directory 边界：实际进入 Plugin/Skill 包根的软链、硬链和特殊文件一律拒绝。跳过无关 archive 条目不能放宽已选 Plugin 子树或目标写盘边界。
- tree/raw 回退必须与 archive 共用 10,000 条目、25 MiB 单文件和 250 MiB 总字节上限，只接受 `040000` 目录与 `100644/100755` 普通文件，拒绝路径逃逸、重复路径、软链、submodule 和其它 mode；最终仍执行 manifest 与 canonical tree hash 校验。
- 解包后的 Plugin 根必须通过 manifest 校验和 P1 canonical tree hash。缓存键绑定 `baseUrl/project/commit/subdir/integrity`；metadata 绑定 `sourceId/baseUrl/project/commit/subdir/integrity`，不得包含 token、header 或用户身份。
- 缓存命中仍须复核 tree hash、manifest ID 和版本。损坏缓存只删除对应不可变缓存项并重新下载，不修改 lock。`prepareLocked()` 只能接受 lock 的 `indexCommit/version/commit/integrity/reference` 与锁定 Marketplace 完全一致的条目。
- `prepareLocked()` 只表示旧 lock 的固定包已经可重放，可以向候选集合登记锁定版本，但不得把 canonical ID 标记为“最新 Marketplace 已准备”。显式远程 `plugin update` 必须在恢复旧 lock 后继续执行 `prepare()`，重新解析 source `ref`、读取当前索引并加载新版候选；Provider 应使用独立的 prepared 状态，不能用 `candidates.has(id)` 兼任索引准备标记。
- `plugin source list`、`plugin auth status` 和未引用远程 source 的本地生命周期保持零网络。远程 add/update 只负责异步准备 Provider，最终解析和写盘复用 `PluginApplicationService`。

### GitHub And External Formats

- GitHub 首版只访问 `api.github.com` 的公共仓库，不创建凭据，也不进入 `plugin auth`。省略 ref 时先读取仓库 `default_branch`；branch/tag/default branch 最终都必须解析成 40 位 commit。
- archive 重定向只接受 HTTPS 的 `api.github.com`、`github.com` 或 `codeload.github.com`。GitHub 与 GitLab 共用 `remote-archive.js` 的危险条目、条目数、单文件、解压总量、subdir 和普通文件边界。
- 首次检查下载固定 commit archive 后在本地检测 Flower、Codex、Claude Code 与 skill-only 入口。多个入口必须返回结构化 `PLUGIN_SOURCE_AMBIGUOUS`；交互选择后以固定 `format/entryPath` 重试。
- 交互式新增来源不得先询问内部 `Source ID`。GitHub 新增只问仓库 URL 或 `owner/repository`，从仓库名生成唯一 source ID 和显示名；ref、subdir 和显示名属于编辑或高级 CLI。GitLab 新增只问项目 URL，从 URL 拆分 `baseUrl/project`，复用同 GitLab 地址已有 OAuth Application ID；仅没有可复用值时再询问 Application ID。
- 交互式新增来源类型页必须有明确的 `返回来源` 和 `退出管理` 动作。用户选择返回、退出、取消预览或确认前失败时不得调用 `source add/update`。
- GitHub 交互检测必须在耗时动作前输出进度：初次检测、歧义选择后重试、保存来源都要给出可读状态。检测失败不退出到 shell，应记录到管理器问题页并保持 source store、项目 `.flower/` 和临时 cache 零持久化。
- Flower Marketplace 搜索只读取并缓存索引快照，按 Plugin ID 聚合全部版本并按 SemVer 降序展示；只有 `prepare(canonicalId)` 才下载被选 Plugin 的版本，禁止发现页预取整个 Marketplace。
- Claude/Codex Marketplace 支持同仓相对路径、GitHub shorthand、GitHub HTTPS URL，以及 GitHub `git-subdir`。公开跨仓条目分别解析目标仓库默认分支或显式 ref；SSH、私有仓库、非 GitHub git-subdir、npm、通用 Git host 和远程 JSON 只产生 unsupported 诊断。
- 没有 Marketplace 时允许把 `plugins/*` 中的多个可识别目录作为一个来源目录；每个目录独立归一化为候选。歧义只在单个选择边界内解决，不能因遍历顺序静默选中。
- inspect/preview 的 cache root 必须由调用方放在操作系统临时目录并在 finally 清理。只有检测和兼容预览完成后才允许原子写 source store；失败、取消或未确认不得创建项目 `.flower/cache`。
- source add/update 的 JSON 成功结果固定包含顶层 `detectedFormat/entryPath/resolvedCommit/compatibility`；不得输出临时 archive URL、headers、凭据或 cache 绝对路径。

## 4. Validation & Error Matrix

| 条件 | 错误 / 结果 |
| --- | --- |
| source 含 secret、未知字段、非法 URL/project/path 或错误 scopes | `PLUGIN_SOURCE_CONFIG_INVALID`，不覆盖原配置 |
| source 配置 JSON 损坏、版本错误或 ID 重复 | `PLUGIN_SOURCE_CONFIG_INVALID`，原文件保持不变 |
| source 不存在或已禁用 | `PLUGIN_SOURCE_NOT_FOUND`，不触发认证或网络 |
| Flower Keyring、同 host `glab` 和 host 绑定环境 fallback 都没有凭据 | `PLUGIN_AUTH_REQUIRED` |
| `glab` 不存在、未登录目标 host、输出不可解析、token 被遮蔽或 host 不匹配 | 当作无外部凭据；status 返回未登录，REST 路径继续尝试后续 fallback |
| `GITLAB_TOKEN` / `GLAB_TOKEN` 存在但没有同 host 环境证据 | 当作无外部凭据，不得跨 host 误用 |
| scope 缺失、Keyring payload 损坏或来源身份不匹配 | `PLUGIN_AUTH_SCOPE_INVALID`，不得退回内存或外部 fallback 掩盖损坏 |
| 浏览器打开、callback 监听或 callback 超时失败 | `PLUGIN_AUTH_FAILED` 且标记允许 Device Flow 降级，关闭临时 callback 状态 |
| OAuth 请求超时/取消，或 state、code、token、scope 校验失败 | `PLUGIN_AUTH_FAILED`，不得自动降级，关闭临时 callback 状态 |
| refresh 失败 | 删除旧凭据并返回 `PLUGIN_AUTH_REQUIRED` |
| REST 超时、网络错误、4xx/5xx 或无效 JSON | `PLUGIN_REMOTE_REQUEST_FAILED`；5xx/网络最多重试一次 |
| GitLab REST 返回 401 | `PLUGIN_AUTH_REQUIRED`，诊断不得包含 token 或 header |
| GitLab REST 返回 403 | `PLUGIN_AUTH_SCOPE_INVALID`，诊断不得包含 token 或 header |
| GitLab REST 返回 3xx | 禁止跟随并返回 `PLUGIN_REMOTE_REQUEST_FAILED`，诊断提示检查 HTTPS baseUrl，且不泄露 token |
| GitLab archive 对 OAuth 返回 406 | 仅对固定 commit/subdir 启用 repository tree/raw 回退，并继续执行同等资源上限与摘要校验 |
| archive 超限、危险条目或顶层结构无效 | `PLUGIN_REMOTE_ARCHIVE_INVALID`，不发布缓存 |
| 全仓扫描遇到未选中目录或仓库根的软链、硬链、特殊文件或单文件超限 | 跳过该条目继续检测；不得发布被跳过条目进入规范化包 |
| 显式 `subdir` 或已选 Plugin/Skill 包根内出现软链、硬链、特殊文件或单文件超限 | `PLUGIN_REMOTE_ARCHIVE_INVALID` / `PLUGIN_UNSAFE_PATH`，不发布缓存 |
| manifest 身份、版本、trust 或 lock/index 不一致 | `PLUGIN_TARGET_DRIFT` 或来源配置错误，不进入 Runtime 写盘 |
| digest 不匹配 | P1 完整性错误包装为稳定 Runtime 错误，删除 staging/损坏缓存 |
| Keyring 不可用 | 使用进程内 store，`persistent=false`，不创建明文凭据文件 |
| `prepareLocked()` 已登记旧候选后执行显式远程 update | 仍须读取当前 Marketplace 并把满足约束的新版候选交给 Resolver；不得因旧候选存在而提前返回 |
| GitHub 403/429 且匿名额度耗尽 | `PLUGIN_REMOTE_RATE_LIMITED`，保留 limit/reset 非敏感诊断，零持久化 |
| GitHub 仓库/ref 不存在、无效 JSON、超时或 5xx | `PLUGIN_REMOTE_REQUEST_FAILED`；5xx/网络最多重试一次 |
| 格式零候选或多候选 | `PLUGIN_FORMAT_UNRECOGNIZED` / `PLUGIN_SOURCE_AMBIGUOUS`；source store 与项目零写入 |
| 交互 GitHub 检测失败 | 管理器切到问题页并记录稳定错误；不退出 shell、不执行 `source add/update` |
| 外部 Skill 路径、Marketplace subdir 或 archive 逃逸来源根 | `PLUGIN_UNSAFE_PATH` 或 `PLUGIN_REMOTE_ARCHIVE_INVALID`，不得包装成泛化 IO 错误 |
| 预览成功、失败或用户取消 | 临时 cache 清理；用户 source store 与项目 `.flower/` 保持不变 |

## 5. Good / Base / Bad Cases

### Good

- 用户执行 `plugin auth login rd-guide`，PKCE 主动请求 `openid profile read_user write_repository api`，实际授权包含 `api` 后凭据进入系统 Keyring；随后 `plugin search --source rd-guide` 使用 Bearer REST 读取固定索引。
- 用户没有 Flower Keyring 凭据，但 `glab auth status --hostname gitlab.xhgjdev.com --show-token` 能证明同 host 并返回 token；`plugin auth status rd-guide --json` 返回 `authorized:true` 且不包含 token，`plugin search --source rd-guide` 使用同一 manager 读取 Marketplace。
- 用户设置 `GITLAB_TOKEN` 与 `GITLAB_HOST=gitlab.xhgjdev.com`；无 `glab` 时 resolver 仍可在当前进程内提供 token，logout 后该 fallback 不受影响。
- 内置 `rd-guide` 随包从 HTTP 升级到 HTTPS 或切换 ref 后，即使用户目录仍有旧版完整 descriptor，运行时也使用新随包连接字段，仅保留用户原有启停选择。
- 已锁定 Plugin 的 metadata、tree hash、manifest 身份全部匹配时，`prepareLocked()` 直接复用缓存，不访问 GitLab。
- 项目先锁定 `rd-guide/demo@1.0.0`，Marketplace 当前索引随后发布 `1.1.0`；显式 `plugin update rd-guide/demo` 先恢复 1.0.0 固定包，再读取新索引并由 Resolver 选择 1.1.0。

### Base

- 系统没有 Keyring：Flower OAuth 登录只在当前进程有效，`auth status --json` 输出 `persistent:false`，不生成 token 文件。
- 外部凭据无法离线获得 scope：status JSON 固定返回 `scopes:[]`，人类输出只在实际 scope 非空时显示 scope，不暴露凭据来源。
- 用户只执行本地 Plugin 命令或禁用 `rd-guide`：GitLab 请求数为 0。
- GitHub source 省略 ref：Provider 读取默认分支，持久化实际 ref/format/entryPath，并在 JSON 中返回固定 commit 与兼容性摘要。
- 交互新增 GitHub source：用户只输入 `https://github.com/obra/superpowers`，检测返回多个入口，用户选择 `.claude-plugin/plugin.json` 后预览 `superpowers/superpowers@6.2.0`，14 个 skills 导入，hooks 仅展示为不会安装，确认后才保存 `format/entryPath`。
- 交互新增 GitLab source：用户输入 `http://gitlab.example.test/team/guide`，UI 自动派生 source ID `guide`、项目路径 `team/guide`，并复用同地址已有 OAuth Application ID。

### Bad

- 把 Application Secret 或 PAT 写入 source JSON、`.flower/plugin-lock.json`、命令参数或 cache metadata。
- 用 `read_repository` scope 失败后绕过 `repository/tree`，或仍主动请求旧 `read_api read_repository` 而不匹配公共 Application。
- 把 `GITLAB_TOKEN` 在没有同 host 证据时用于任意 GitLab source，或把 `glab --show-token` 原始输出写进错误、日志或任务记录。
- 让 fetch 自动跟随携带 Authorization 的跨 scheme 重定向，最终把匿名 404 当成项目不存在。
- archive 解包后不校验 subdir、manifest 和 canonical tree hash就发布缓存。
- Keyring 返回损坏 JSON 时吞掉错误并切换到内存，让调用方误以为只是“未登录”。
- 把 `candidates.has(canonicalId)` 当作 `prepare()` 的幂等门禁；`prepareLocked()` 会先写入旧候选，导致显式远程 update 永远看不到新索引版本。
- 在发现页下载 Marketplace 的每个 Plugin archive，或用项目 `.flower/cache` 承载尚未确认的来源预览。
- 捕获 `PLUGIN_UNSAFE_PATH`、schema 或格式歧义后统一包装成 `PLUGIN_IO_ERROR`，导致调用方失去稳定诊断。
- 交互新增来源时先问 `Source ID`、`format`、`entryPath` 等内部字段，或检测失败后直接退出管理器让用户回到 shell。

## 6. Tests Required

- `plugin-source-store.test.js`：内置 `rd-guide` 新请求 scope、XDG/权限、启停与恢复、旧完整覆盖只继承 enabled、v3 偏好压缩、secret/未知字段/损坏 JSON、读取零网络、旧 descriptor scope 兼容。
- `plugin-credential-store.test.js`：版本化副本、Keyring 运行失败的内存降级、损坏 payload 不降级、递归脱敏、`api` 与旧 `read_api + read_repository` scope 兼容。
- `plugin-oauth.test.js`：PKCE S256/state/一次性 callback/公共客户端、新请求 scope、环境失败降级与认证失败不降级、OAuth 请求超时、Device pending/slow_down/请求中取消且不继续轮询、scope 验证、redirect URI refresh、并发单飞与 refresh 清理、同 host `glab` 与 host 绑定环境 fallback。
- `plugin-gitlab-rest-client.test.js`：Bearer、禁用重定向、project/file 编码、commit/tree 分页/files/archive、大小限制、超时和一次重试、401/403 认证类错误映射与脱敏。
- `plugin-gitlab-provider.test.js`：index commit、candidate/lock 字段、不可变缓存、损坏重下、archive 链接/路径/限额、OAuth 406 tree/raw 回退、subdir、digest、manifest 身份和 trust 上限。
- `plugin-remote-cli.test.js`：source/auth/search 参数、非敏感 JSON、管理命令零网络、status/search 复用 resolver、logout 不删除 fallback、远程 add/update 复用 Application Service、自定义 local source ID 不误判为 GitLab。
- `plugin-e2e-gitlab.test.js`：真实 CLI 跨进程覆盖 Device Flow、PKCE、search、v1 add、切换 Marketplace 后的 v2 update、禁用零网络，以及 stdout/stderr/项目文件敏感值扫描；必须断言旧 lock 候选不会阻止当前索引准备。
- `plugin-github-rest-client.test.js`：默认分支、commit/date、允许的 redirect host、匿名限流、大小限制、超时和重试。
- `plugin-github-provider.test.js`：Flower 索引懒加载与版本聚合、跨仓 Marketplace、多 Plugin 目录、固定/默认 ref、cache、locked replay、全仓扫描无关软链跳过、已选子树危险条目拒绝和稳定错误类型。
- `plugin-format-adapters.test.js`：检测顺序、歧义、Codex/Claude/skill-only 规范化、Skill 路径 containment、主动组件只诊断和 YAML frontmatter 安全。
- `plugin-remote-cli.test.js` 与 `plugin-interactive.test.js`：descriptor v2/store v3、`--clear-subdir`、format 重置、JSON 字段、来源类型返回/退出、GitHub/GitLab 新增只问用户可识别 locator、检测进度、失败留在问题页、歧义选择和临时预览 cache 清理。
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

### Wrong: 在调用点直接读取通用环境 token

```js
const token = process.env.GITLAB_TOKEN;
const client = new GitLabRestClient({ source, credentialManager: { getAccessToken: async () => token } });
```

这种写法无法证明 token 属于当前 source host，也会让 status、search、lifecycle 三条路径重新分叉。

### Correct: 只通过统一 resolver 接入外部凭据

```js
const manager = new GitLabCredentialManager({
  store,
  oauth,
  env: process.env,
});
const client = new GitLabRestClient({ source, credentialManager: manager });
```

resolver 负责按 Flower Keyring、同 host `glab`、host 绑定环境 fallback 的顺序解析；REST client 仍只知道 `getAccessToken(source)`。

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

### Wrong: 预览复用项目缓存

```js
const provider = new GitHubSourceProvider({ source, cacheRoot: path.join(projectRoot, ".flower/cache") });
await provider.inspect();
```

确认前的探测会污染项目，并让取消和失败留下持久状态。

### Correct: 隔离并清理探测缓存

```js
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flower-plugin-inspect-"));
try {
  return await new GitHubSourceProvider({ source, cacheRoot: temporaryRoot }).inspect();
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
```

只有 inspect 成功且用户确认后才写入 source store；真正安装仍通过 Runtime 使用项目不可变缓存。

### Wrong: 把 archive 不支持条目一概当作致命错误

```js
if (!ALLOWED_ARCHIVE_TYPES.has(entry.type)) {
  unsafeEntry = entry.path;
  return false;
}
```

公开 GitHub 仓库根目录可能包含与 Plugin 无关的 symlink，例如 `AGENTS.md -> CLAUDE.md`。全仓格式检测阶段直接失败会阻断本可安全导入的 `.codex-plugin` 或 `.claude-plugin`。

### Correct: 只对已选子树保持致命，未选中无关条目跳过

```js
if (!ALLOWED_ARCHIVE_TYPES.has(entry.type) || entrySize > MAX_ENTRY_BYTES) {
  if (isInsideSelectedSubdir(normalizedEntryPath, selectedSubdir)) unsafeEntry ||= entryPath;
  return false;
}
```

路径穿越、绝对路径、反斜杠、`.`/`..`、条目数和解压总量仍是全局致命错误；真正进入 Plugin/Skill 包根的复制阶段还会再次拒绝软链和特殊文件。
