# Flower Plugin GitLab Marketplace、OAuth 与 Keyring

## 目标

基于 P1 的 Marketplace/schema 契约和 P2 的 Source Registry 接口，实现私有 GitLab Marketplace 访问、用户级来源配置、OAuth 登录与系统凭据存储，使用户能够按需发现和下载 `rd-guide` 中的 Plugin，同时保持未使用远端来源时零网络、凭据不落项目文件。

本任务是父任务 P3，依赖 P1；与 P2 通过 Provider/Source Registry DTO 对接。目标 GitLab 为 `http://gitlab.xhgjdev.com` 18.10.1，按当前已确认决策视为安全传输等价环境，不增加 HTTP 特殊降级分支。

## 已确认事实

- 使用实例级 OAuth Application；CLI 是公共客户端，不使用或保存 Application Secret。
- 浏览器环境优先 Authorization Code + PKCE S256；无浏览器或显式选择时使用 Device Authorization Grant。
- 默认 scopes 固定为 `read_repository read_api`，不申请具有写权限的 `api`。
- 真实验证表明 `read_repository` 可访问 Git-over-HTTP，但 `repository/tree` 需要 `read_api`；两者组合后 Git 与 tree 均返回 200。
- OAuth token 必须与项目配置、Plugin manifest、lockfile、state 和日志隔离。
- `rd-guide` 是随包预注册、可禁用、按需连接的默认 Marketplace；预注册不代表启动访问远端。

## 需求

### R1. 用户级 Source Registry

- 实现用户级来源配置，遵循 XDG config 目录并与项目 `.flower/` 状态分离。
- 随包内置 `rd-guide` source descriptor，包含 source ID、GitLab base URL、项目路径、Marketplace manifest 路径、OAuth Application ID 和固定 scopes，不包含 secret。
- 用户可 list、add、remove、update、enable、disable 来源；内置来源只能禁用或覆盖允许字段，不能修改包内文件。
- 项目 `plugins.json` 只引用 source ID，不保存 GitLab URL、Application ID、token 或用户身份。
- 来源配置损坏时返回结构化错误，不静默丢弃或覆盖。

### R2. 惰性远端访问

- 普通 CLI 启动、`init`、本地 provider、lock 重放和未引用 `rd-guide` 的操作不得发起 GitLab 网络请求。
- `plugin search`、远端详情、首次远端 add 和显式远端 update 才允许访问来源。
- 禁用来源不参与 search、候选解析或认证触发。
- 网络请求必须具备超时、取消、有限重试和稳定错误码；认证失败与网络失败分开报告。

### R3. GitLab Marketplace Provider

- 使用 Bearer header 调用 GitLab REST API，token 不得进入 URL、Git remote、子进程参数或日志。
- project path 必须 URL 编码；从固定项目读取 `.flower-marketplace/marketplace.json` 并通过 P1 schema 校验。
- 记录 Marketplace index commit；版本解析必须落到不可变 Plugin commit 和 canonical tree hash。
- 支持 repository tree、Repository Files 和 repository archive 等只读端点；下载后在隔离缓存目录安全解包。
- archive 解包拒绝绝对路径、`..`、软链、硬链和特殊文件，并限制所有内容位于指定 Plugin subdir。
- 对下载结果重新计算 P1 canonical tree hash，与 Marketplace digest 不一致时拒绝。
- 缓存键绑定 GitLab host、project、commit、subdir 和 digest；缓存损坏可删除并重新下载，不影响 lock。

### R4. Authorization Code + PKCE

- 生成高熵 state、code verifier 和 S256 code challenge。
- loopback callback 只监听本机随机可用端口，验证 state，并在收到一次有效回调后关闭。
- 不自动提交或保存 Application Secret；token exchange 使用公共客户端参数。
- 浏览器无法打开、callback 不可用或用户显式 `--device` 时可切换 Device Flow。
- callback 页面不显示 token、授权码或内部错误详情。

### R5. Device Authorization Grant

- 调用 GitLab device authorization 端点，向用户展示 verification URI 和 user code。
- 轮询 token 端点并正确处理 authorization_pending、slow_down、access_denied、expired_token 和取消。
- `slow_down` 增加轮询间隔；超时或拒绝后停止，不无限轮询。
- user code、device code 和 token 不进入任务文件、测试 fixture 快照或普通日志。

### R6. Token 生命周期

- token payload 包含 access token、refresh token、scope、created/expiry 元数据和 token type。
- 请求前判断有效期并提前刷新；并发请求共享单次 refresh，避免 refresh token 竞争。
- refresh 失败或 scope 不满足时清除失效凭据并允许重新授权。
- `plugin auth login|logout|status` 支持指定 source；status 只输出登录状态、scope 和到期摘要，不输出 token。
- 运行时验证授权 scope 至少包含 `read_repository read_api`；缺失时触发重新授权而不是降级端点。

### R7. CredentialStore 与 Keyring

- 定义可替换 `CredentialStore` 接口，支持 get/set/delete，不向调用方暴露 keyring 实现细节。
- 优先使用 `@napi-rs/keyring`，作为 optional dependency；service 固定为 Flower 命名空间，account 由 GitLab host/source ID 唯一确定。
- keyring 不可用时只允许当前进程内 token，不提供明文文件 fallback。
- keyring payload 作为一个版本化 JSON credential 保存，读取时校验结构与来源身份。
- 所有异常和 debug 日志必须经过敏感字段清理，禁止打印 Authorization header、access token、refresh token、device code 或 authorization code。

### R8. CLI

- 实现：
  - `plugin source add|list|remove|update|enable|disable`
  - `plugin auth login|logout|status`
  - `plugin search [query] [--source] [--json]`
- 远端 add/update 通过 P2 application service 和 Provider 接口接入，不在 P3 复制生命周期写盘逻辑。
- JSON 输出包含 source、候选、版本和诊断，不包含凭据、绝对缓存路径或响应 header。

## 验收标准

- [ ] 未使用或已禁用 `rd-guide` 时，普通 CLI、init、本地操作和 lock replay 的 GitLab 请求数为 0。
- [ ] HTTP mock 覆盖 Marketplace index、tree/files/archive、URL 编码、commit/digest 和缓存命中/损坏。
- [ ] archive 解包拒绝路径穿越、软/硬链、特殊文件和 subdir 逃逸。
- [ ] PKCE 覆盖 state、S256、loopback、一次性回调、浏览器失败和 token exchange。
- [ ] Device Flow 覆盖 pending、slow_down、denied、expired、取消和成功。
- [ ] refresh 处理到期、并发、失效 refresh token 和 scope 缺失。
- [ ] keyring adapter、内存 fallback、logout 和 status 有测试，明文文件 fallback 不存在。
- [ ] 全部日志、错误、JSON 和 fixture 通过敏感字段扫描。
- [ ] 使用 mock token 验证 `read_repository read_api` 读取路径；写 API 请求不在实现中出现。
- [ ] 最终人工 smoke test 可使用真实 GitLab 验证 Git、repository/tree 和 archive 成功，token 不出现在命令输出或项目 diff。
- [ ] 现有本地/builtin Provider、CLI 和完整 `npm test` 回归通过。

## 非目标

- 不修改 GitLab 实例 HTTPS、证书、OAuth Application 或权限配置。
- 不实现写仓库、创建 MR、发布 tag 或 GitLab 管理 API。
- 不保存 Application Secret，不提供 PAT 明文配置回退。
- 不实现 Plugin 内容写盘、依赖求解或 Patch capability。
