# Brief — Plugin 复用全局 GitLab 凭据与新 OAuth scope

## Goal

- 让 Flower Plugin 的 `rd-guide` 与其它 GitLab source 复用全局 `glab` 或 PAT 凭据，并把 Flower OAuth 主动请求 scope 调整为新的公共 Application scope，同时保持 TUI 登录体验不区分凭据来源。

## Scope

- 增加 GitLab 凭据解析链：Flower Keyring OAuth 凭据优先，其次同 host 的 `glab` 凭据，再其次安全绑定到同 host 的环境/PAT fallback。
- 调整 Flower OAuth 主动请求 scope 为 `openid profile read_user write_repository api`。
- 改造 scope 校验，兼容旧 `read_api + read_repository` 和新 `api` 超集授权。
- 让 `plugin auth status`、Marketplace search、远程生命周期命令和 TUI 使用同一凭据解析语义。
- 保持 `glab`/PAT token 只在当前进程内使用，不写入 Flower Keyring、source store、项目 `.flower/`、lock、state、cache metadata 或普通输出。
- 补齐 credential resolver、OAuth scope、remote CLI、interactive TUI 和敏感信息边界测试。

## Non-Goals

- 不把 OAuth redirect URI 改成固定 `localhost:7171/auth/redirect`。
- 不新增 GitLab Application 创建流程，也不保存 Application Secret 或 PAT 到 source 配置。
- 不改变 GitHub 公共 source 的匿名策略。
- 不在 TUI 文案中区分 Flower OAuth、`glab` 或 PAT。
- 不使用 `write_repository` 做写仓库、建 MR、推送或任何高影响 GitLab 操作。

## Key Decisions

- 保留现有 PKCE redirect 与 Device Flow 降级行为；本任务只改主动请求 scope 和凭据解析链。
- 凭据来源在 TUI 上不区分：只要同 host 全局凭据可用，就显示已登录并加载 Marketplace。
- `plugin auth logout` 只删除 Flower Keyring 凭据，不删除 `glab` 配置或环境变量；如果 fallback 仍存在，logout 后仍可显示已登录。
- `api` 视为满足当前 GitLab REST 读取能力；旧 `read_api + read_repository` token 继续兼容。
- `glab` 读取默认使用 `glab auth status --hostname <host> --show-token`，捕获输出后只解析 token，不透传原文。

## Key Context

- 当前任务目录：`.trellis/tasks/08-27-plugin-global-gitlab-auth-scope`。
- 相关规范：`.trellis/spec/flower-trellis/cli/flower-plugin-gitlab.md`、`.trellis/spec/flower-trellis/cli/cli-output.md`、`.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md`。
- 当前证据记录：`.trellis/tasks/08-27-plugin-global-gitlab-auth-scope/research/current-auth-behavior.md`。
- 主要代码入口：`src/plugin/auth/credential-store.js`、`src/plugin/auth/keyring-credential-store.js`、`src/plugin/auth/gitlab-oauth.js`、`src/plugin/gitlab/rest-client.js`、`src/commands/plugin-remote.js`、`src/commands/plugin-interactive.js`、`src/plugin/sources/user-source-store.js`、`src/builtin-marketplaces/rd-guide.json`。

## Risks / Deferred

- `glab --show-token` 输出格式需要用测试注入固定解析边界，真实命令只做手动验证，不在测试中读取真实 token。
- 通用 `GITLAB_TOKEN`/`GLAB_TOKEN` 必须避免跨 host 误用，需要通过 host 匹配或明确约定后才进入 fallback。
- 固定 `localhost:7171/auth/redirect` 迁移已明确延后。

## Acceptance

- `rd-guide` 只有同 host `glab` 登录或可用 PAT fallback 时，CLI JSON status 返回已授权，TUI 不再提示 Flower 单独登录。
- 没有 Flower Keyring 凭据但有全局凭据时，`plugin search --source rd-guide --json` 能读取 Marketplace。
- OAuth 授权 URL 请求新 scope，并且旧 scope Keyring 凭据和新 `api` scope 凭据都能通过校验。
- `glab`/PAT fallback 不被 `plugin auth logout` 删除，也不会进入任何 Flower 持久化文件或普通输出。
- 认证失败、scope 不足、host 不匹配、`glab` 不存在或输出不可解析时，CLI/TUI 返回稳定、脱敏的未登录或重新登录状态。
- 定向 Node 测试、`git diff --check` 和敏感字段扫描通过。

## Next Step

- 用户确认本 brief 后，运行 `task.py start` 进入实现阶段，并按 `trellis-route(target=implement)` 选择实现方式。
