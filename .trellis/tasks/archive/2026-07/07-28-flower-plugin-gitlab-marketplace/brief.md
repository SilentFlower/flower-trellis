# Brief — Flower Plugin GitLab Marketplace、OAuth 与 Keyring

## Goal

- 实现私有 GitLab Marketplace、OAuth 和系统凭据存储，使 `rd-guide` Plugin 可按需发现和下载，同时保持零隐式联网和凭据隔离。

## Scope

- 用户级 Source Registry、内置可禁用 `rd-guide` descriptor 和惰性访问。
- GitLab index/tree/files/archive Provider、安全解包、固定 commit/digest 和缓存。
- Authorization Code + PKCE、Device Flow、refresh、logout/status。
- `CredentialStore`、optional keyring adapter 和进程内 fallback。
- source/auth/search CLI 以及对 P2 远端 add/update 的 Provider 接入。

## Non-Goals

- 不配置 GitLab 实例，不使用 Application Secret，不实现写 API、MR 或 tag 发布。
- 不实现依赖求解、项目内容写盘或 Patch capability。

## Key Context

- 固定 scopes 为 `read_repository read_api`，不申请 `api`。
- 未使用或禁用 `rd-guide` 时 GitLab 请求数必须为 0。
- token 只进入系统 keyring或当前进程内存，不得进入 URL、argv、项目文件、缓存元数据、JSON 或日志。
- archive 在进入缓存前拒绝路径穿越、链接、特殊文件和 subdir 逃逸，并验证 canonical tree hash。
- HTTP 目标按已确认的安全传输等价环境处理，不新增降级分支。

## Acceptance

- GitLab mock 覆盖 index、tree/files/archive、缓存、commit/digest 和安全解包。
- PKCE 与 Device Flow 全状态、refresh 并发和 scope 缺失有测试。
- keyring、内存 fallback、logout/status 和敏感字段扫描通过。
- 真实 smoke test 验证 Git、tree、archive 可读，写 API 未使用，项目无 token diff。

## Next Step

- P1 契约稳定后实现来源与凭据；P2 Provider 接口稳定后完成远端生命周期接入。
