# Implement — Plugin 复用全局 GitLab 凭据与新 OAuth scope

## Checklist

1. 读取目标模块和测试，确认当前签名：`credential-store.js`、`keyring-credential-store.js`、`gitlab-oauth.js`、`rest-client.js`、`plugin-remote.js`、`plugin-interactive.js`、`user-source-store.js`。
2. 拆分 GitLab OAuth scope 常量：请求 scope 使用 `openid profile read_user write_repository api`，校验逻辑接受 `api` 或旧 `read_api + read_repository`。
3. 更新内置 `rd-guide` descriptor 与 source descriptor 校验，允许新 scope 并兼容旧 scope。
4. 增加 GitLab 凭据解析层，优先 Flower Keyring，其次同 host `glab`，最后安全的环境/PAT fallback；所有 token 只在内存中传递。
5. 改造 `GitLabCredentialManager` 与 `getPluginAuthStatus()`，让 status/search/lifecycle 共享同一解析链。
6. 调整 REST 认证失败映射，确保 fallback token 无效或权限不足时返回认证类稳定诊断。
7. 保持 TUI 文案和分支不区分凭据来源，仅用 `authorized` 控制发现页加载和来源状态。
8. 补齐测试：credential resolver、OAuth scope、旧 scope 兼容、glab/env fallback、logout 不删除 fallback、TUI 状态不区分来源、敏感信息不输出。

## Validation

- `node --test test/js/plugin-credential-store.test.js`
- `node --test test/js/plugin-oauth.test.js`
- `node --test test/js/plugin-remote-cli.test.js`
- `node --test test/js/plugin-interactive.test.js`
- `node --test test/js/plugin-gitlab-rest-client.test.js`
- `git diff --check`
- 敏感字段扫描：在相关测试临时输出和项目文件中搜索 `Authorization`、`accessToken`、`refreshToken`、`GITLAB_TOKEN`、测试 PAT 字符串。

## Risky Files

- `src/plugin/auth/credential-store.js`
- `src/plugin/auth/keyring-credential-store.js`
- `src/plugin/auth/gitlab-oauth.js`
- `src/plugin/gitlab/rest-client.js`
- `src/commands/plugin-remote.js`
- `src/commands/plugin-interactive.js`
- `src/plugin/sources/user-source-store.js`
- `src/builtin-marketplaces/rd-guide.json`

## Rollback Points

- 如果 `glab` 输出解析不稳定，先保留环境/PAT fallback 与新 OAuth scope，延后 glab provider。
- 如果 source descriptor scope 兼容触发旧配置问题，优先让内置 descriptor 更新走随包权威、用户覆盖只继承 enabled。
- 如果固定测试无法安全覆盖真实 `glab` 行为，使用注入式 fake command runner，并把真实命令验证留给手动检查。
