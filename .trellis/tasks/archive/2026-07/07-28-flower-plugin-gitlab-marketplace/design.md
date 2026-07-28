# Flower Plugin GitLab Marketplace、OAuth 与 Keyring 技术设计

## 1. 架构

```text
plugin source/auth/search CLI
          |
 user source registry
          |
    gitlab provider ---- credential store
          |                    |
 GitLab REST client       keyring / memory
          |
 index + archive cache
          |
 P1 validator/hash -> P2 PluginCandidate/package
```

Provider 只负责远端来源与标准包，不写项目目标；CredentialStore 不理解 Marketplace；CLI 不直接操作 token。

## 2. 建议文件布局

```text
src/plugin/
├── auth/
│   ├── credential-store.js
│   ├── keyring-credential-store.js
│   ├── memory-credential-store.js
│   └── gitlab-oauth.js
└── sources/
    ├── user-source-store.js
    └── gitlab-provider.js
src/builtin-marketplaces/rd-guide.json
```

`@napi-rs/keyring` 通过动态 import 加载，缺失或系统后端不可用时使用进程内 store；不得捕获异常后改写明文配置。

## 3. Source 合并

优先级为内置 descriptor、用户级覆盖、命令临时覆盖。用户配置只保存 enable 状态和允许覆盖字段。内置 `rd-guide` descriptor 在首次使用前只是数据，不构造网络客户端或触发认证。

## 4. OAuth 状态机

### PKCE

`idle -> browser-opened -> callback-received -> exchanging -> stored`，任一 state/timeout/cancel 错误进入 terminal failure 并关闭 server。callback 只接受预期路径、GET 和单次 state。

### Device Flow

`requesting -> awaiting-user -> polling -> stored`。pending 保持间隔，slow_down 增加间隔，denied/expired/cancelled 终止。轮询采用可注入 clock/sleep，测试不真实等待。

token refresh 由 credential manager 串行化，同一 source 同时只有一个 refresh promise。

## 5. GitLab 请求与下载

- REST client 统一拼接 base URL、编码 project path、注入 Bearer header、超时与诊断清理。
- index 读取后保存响应对应 commit；候选版本必须引用固定 commit。
- archive 下载到 `.flower/cache/` 下 staging，先验证容器条目，再提取目标 subdir。
- 解包完成后计算 canonical tree hash；只有 schema、commit 和 digest 全部通过才原子发布缓存目录。
- 缓存只由不可变键命中；缓存元数据不保存 token 或响应 header。

## 6. Credential key

- service：`flower-trellis`。
- account：规范化 GitLab host 与 source ID 的组合。
- payload：包含 schema version、source identity、token type、scope、access/refresh token 与 expiry。
- status 输出由 payload 派生的非敏感摘要。

## 7. 安全与回滚

- 敏感值只存在内存、系统 keyring 和 TLS/当前已确认传输等价连接中。
- 调试 formatter 对已知 token 字段、Authorization header 和 OAuth code 字段递归脱敏。
- P3 失败时 builtin/local provider 仍可使用；远端 source 返回不可用，不降级为明文 token。
- 删除缓存不影响 project lock；logout 只删 credential，不改项目声明。
