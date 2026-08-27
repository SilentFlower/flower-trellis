# Current Auth Behavior

## Evidence

- `src/builtin-marketplaces/rd-guide.json` 当前内置 source 为 `rd-guide`，baseUrl 是 `https://gitlab.xhgjdev.com`，project 是 `digital-rd-governance/rd-guide`，OAuth scopes 为 `read_api`、`read_repository`。
- `src/plugin/sources/user-source-store.js` 的 `flowerConfigDirectory()` 把 source 配置放在用户级 XDG/APPDATA 目录；内置 source 的用户覆盖只继承 `enabled`。
- `src/plugin/auth/credential-store.js` 当前 `GITLAB_OAUTH_SCOPES` 固定为 `read_api`、`read_repository`，`validateCredential()` 要求凭据 scope 包含这两个值。
- `src/plugin/auth/keyring-credential-store.js` 当前 Keyring service 为 `flower-trellis`，account 由 `credentialAccount(source)` 生成，即 `<host>/<source-id>`。
- `src/commands/plugin-remote.js` 的 `getPluginAuthStatus()` 当前只读取 `credentialBundle.store.get(source)`；远程 search/lifecycle 也只构造基于 Flower store 的 `GitLabCredentialManager`。
- `src/plugin/auth/gitlab-oauth.js` 当前 PKCE 登录使用随机 `127.0.0.1:<port>/oauth/callback`，授权 URL 的 scope 来自旧 `GITLAB_OAUTH_SCOPES`。
- 本地 `createCredentialStore()` 返回 `persistent: true`，但 `flower-trellis plugin auth status rd-guide --json` 返回 `authorized: false`。
- 本地 `glab auth status` 显示同一 host `gitlab.xhgjdev.com` 已登录，且 token 来源为 `GITLAB_TOKEN`；这说明“每项目需要登录”的根因不是没有 GitLab 凭据，而是 Flower 未接入全局凭据解析链。
- `glab 1.109.0` 的 help 显示可用 `glab auth status --hostname <host> --show-token`，但没有独立 `glab auth token` 子命令。

## Planning Conclusions

- source 配置和 Keyring 设计已经具备跨项目复用基础，本任务重点是把 Flower OAuth store、`glab`、环境/PAT fallback 接成统一 resolver。
- OAuth redirect 不在本任务迁移，继续保留现有 PKCE/Device Flow 行为。
- 新公共 Application scope 需要改变“请求 scope”和“校验 scope”的模型，否则 `api` 这种超集权限会被旧校验误判为无效。
