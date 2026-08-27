# Plugin 复用全局 GitLab 凭据与新 OAuth scope

## Goal

让 Flower Plugin 的 rd-guide/GitLab source 复用全局 glab 或 PAT 凭据，并把 Flower OAuth 主动请求 scope 调整为新公共 Application scope，同时保持 TUI 登录体验不区分凭据来源。

## Background

- 内置 `rd-guide` source 指向 `https://gitlab.xhgjdev.com/digital-rd-governance/rd-guide`，当前随包 descriptor 的 OAuth scopes 仍是 `read_api`、`read_repository`。
- 当前 source store 已是用户级配置，默认路径为 XDG/APPDATA 下的 `flower-trellis/plugin-sources.json`，不是项目 `.flower`。
- 当前 Flower OAuth 凭据写入系统 Keyring，account 为 `<lowercase-host>[:port]/<source-id>`；这本身具备跨项目复用条件。
- 当前 `plugin auth status` 只读取 Flower Keyring，不读取 `glab`、`GITLAB_TOKEN`、`GLAB_TOKEN` 或其它 PAT fallback，因此用户在 `glab` 已登录同一 GitLab host 时仍会看到 Flower Plugin “需要登录”。
- 用户确认：保留原有 redirect URI 兼容逻辑，不强制切到固定 `http://localhost:7171/auth/redirect`；Flower OAuth 主动请求按新的公共 Application scope。

## Requirements

- R1: GitLab 凭据解析链按顺序执行：Flower Keyring OAuth 凭据、同 host 的 `glab` 凭据、可安全绑定到同 host 的环境/PAT fallback；都没有时才返回未登录或 `PLUGIN_AUTH_REQUIRED`。
- R2: `glab` 与 PAT fallback 只用于当前进程的 GitLab REST 请求，不写入 Flower Keyring、用户 source 配置、项目 `.flower/`、lock、state、cache metadata、任务文件或普通输出。
- R3: TUI 与 CLI 管理视图不区分凭据来源。只要解析链能提供可用凭据，现有发现页和来源页应继续显示“已登录”并加载 Marketplace；没有可用凭据时才显示“需要登录/未登录/重新登录”。
- R4: Flower OAuth 主动请求 scope 调整为 `openid profile read_user write_repository api`，以匹配新的公共 OAuth Application。
- R5: 凭据校验必须兼容旧授权和新授权：旧 token 具备 `read_api` + `read_repository` 时继续可用；新 token 具备 `api` 时视为满足 GitLab REST 读取能力。返回的 scope 可保留实际授权结果。
- R6: 保留现有 PKCE redirect 行为和 Device Flow 降级行为，不把本任务扩展为固定 `localhost:7171/auth/redirect` 的回调迁移。
- R7: GitLab REST 客户端、Marketplace search、远程 add/update/verify/remove/replay 使用同一凭据解析链，避免 status 显示已登录但实际请求仍因走旧 manager 失败。
- R8: 认证失败、scope 不满足、host 不匹配、`glab` 不存在或输出不可解析必须给出稳定诊断，并且不得泄露 token。

## Acceptance Criteria

- [ ] 只有同 host `glab` 登录或 `GITLAB_TOKEN` fallback 时，`flower-trellis plugin auth status rd-guide --json` 返回已授权状态；TUI 发现页不再提示 `rd-guide` 需要 Flower 单独登录。
- [ ] 没有 Flower Keyring 凭据但有可用全局凭据时，`flower-trellis plugin search --source rd-guide --json` 能读取 Marketplace。
- [ ] Flower OAuth 登录发起的授权 URL 请求 `openid profile read_user write_repository api`，不再主动请求旧的 `read_api read_repository`。
- [ ] 旧 Keyring 凭据只含 `read_api read_repository` 时仍被接受并可用于搜索；新 Keyring 凭据只要含 `api` 也被接受。
- [ ] `glab`/PAT fallback 不会被 `plugin auth logout` 删除，也不会被写入任何 Flower 持久化文件。
- [ ] stdout/stderr、source store、`.flower/plugin-lock.json`、`.flower/state.json`、cache metadata 和测试临时文件中不出现 token、Authorization header 或 PAT 字段。
- [ ] `glab` 不存在、未登录目标 host、token 失效或 scope 不足时，CLI/TUI 仍显示可理解的未登录或重新登录状态，不抛出未脱敏异常。
- [ ] 定向测试覆盖 credential resolver、OAuth scope、remote CLI status/search、interactive TUI 状态；提交前运行相关 Node 测试、`git diff --check`，并至少跑一次敏感字段扫描。

## Out Of Scope

- 不把 OAuth redirect URI 改成固定 `localhost:7171/auth/redirect`。
- 不新增 GitLab Application 创建流程，也不在 source 配置中保存 Application Secret 或 PAT。
- 不改变 GitHub 公共 source 的匿名策略。
- 不改变 TUI 的登录文案层级为“Flower/glab/PAT”三种显示。
- 不把 `write_repository` 用于写仓库、建 MR、推送或任何高影响 GitLab 操作；本任务只解决 Plugin Marketplace 读取和安装所需的认证。
