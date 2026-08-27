# Design — Plugin 复用全局 GitLab 凭据与新 OAuth scope

## Architecture

本任务在现有远程 Plugin 认证边界内增加一个 GitLab 凭据解析层，而不是把 `glab` 或 PAT 写进 source descriptor。

- `UserSourceStore` 继续只管理用户级 source descriptor 和内置 source 启停偏好。
- `CredentialStore` 继续表示 Flower 自己管理的 OAuth Keyring 凭据。
- 新增或扩展一个 GitLab credential resolver，面向 `GitLabCredentialManager` 和 `getPluginAuthStatus()` 提供统一的非敏感状态与 access token。
- `GitLabRestClient` 仍只通过 `credentialManager.getAccessToken(source)` 取得 Bearer token，不直接知道 token 来自 Flower、`glab` 还是环境 fallback。

## Credential Resolution

解析链按以下顺序短路：

1. Flower Keyring OAuth credential：可刷新、可由 `plugin auth login/logout` 管理。
2. `glab` credential：仅当 `glab auth status --hostname <source-host> --show-token` 能证明登录的是同一 host 时读取；捕获输出后只提取 token，不透传原文。
3. 环境/PAT fallback：优先使用能明确绑定 host 的来源；对通用 `GITLAB_TOKEN`/`GLAB_TOKEN`，只在当前 `glab auth status --hostname <source-host>` 指向同 host 或项目约定明确时使用。

resolver 返回结构应包含：

- `authorized`: 是否找到可尝试的凭据。
- `scopes`: Flower OAuth 可返回实际 scope；fallback 若无法离线得知 scope，可返回空数组或只返回已知能力标签。
- `expiresAt`: Flower OAuth 沿用原值；fallback 默认为 `null`。
- `persistent`: 只表示 Flower Keyring 凭据是否持久化；fallback 不应伪装成 Flower 持久凭据。
- `accessToken`: 只在内部 token 读取路径返回，不能进入 JSON 输出、诊断、日志或持久化文件。

## OAuth Scope Compatibility

定义两组 scope 语义：

- 请求 scope：`openid profile read_user write_repository api`。
- 可接受能力：`api`，或旧组合 `read_api` + `read_repository`。

`credentialFromToken()` 与 `validateCredential()` 不应再把 `GITLAB_OAUTH_SCOPES` 当作唯一可接受集合。建议拆成：

- `GITLAB_OAUTH_REQUEST_SCOPES`
- `isGitLabCredentialScopeSufficient(scopes)`

source descriptor 中的 `oauth.scopes` 也应支持新请求 scope，同时兼容旧随包或用户覆盖配置，避免升级后旧配置立即损坏。

## Redirect Compatibility

保留当前 PKCE redirect 机制：随机本地端口、`127.0.0.1`、`/oauth/callback`，并继续支持 Device Flow 降级。本任务不引入固定 `localhost:7171/auth/redirect`，因此不会处理端口占用、WSL loopback 映射或固定回调并发互斥问题。

## CLI/TUI Behavior

- `plugin auth status` 使用 resolver 给出状态，不触发网络 Marketplace 读取，不输出 token。
- TUI 的发现页和来源页继续只消费 `authorized` 语义，因此全局凭据可用时直接显示已登录。
- `plugin auth logout` 只删除 Flower Keyring 中的 OAuth 凭据，不删除 `glab` 配置或环境变量；如果 fallback 仍可用，logout 后 status 可能仍是 authorized，这是正确行为，需要在测试中固定。
- 搜索和生命周期命令使用同一个 manager/resolver，避免 auth status 和实际 REST 请求路径分叉。

## Security

- 禁止把 token 拼入 URL、命令参数、source JSON、`.flower` 文件、cache metadata 或普通输出。
- `glab --show-token` 的原始输出只能在内存中解析，异常路径必须先脱敏再进入诊断。
- Host 必须从 `source.baseUrl` 解析并精确匹配；不得用当前 git remote 或当前目录推断其它 host。
- scope 不足和 401/403 应映射为认证相关稳定错误，TUI 展示为需要登录或重新登录，而不是 Marketplace 普通加载失败。

## Migration

- 现有旧 Keyring OAuth 凭据继续有效。
- 内置 `rd-guide` descriptor 更新到新 scope 后，用户级旧完整 descriptor 仍按现有规则只继承启停偏好，不覆盖随包连接字段。
- 如果旧 OAuth refresh 因 Application scope/redirect 历史差异失败，保持现有 refresh 失败后删除旧 Flower 凭据并提示重新登录的语义。
