# Flower Plugin GitLab Marketplace、OAuth 与 Keyring 实施计划

## 1. 前置门禁

- [ ] P1 Marketplace/schema、canonical hash 和错误模型已冻结。
- [ ] P2 Source Registry/Provider DTO 已冻结或提供兼容适配。

## 2. 实施步骤

### A. 用户来源与内置 descriptor

- [ ] 实现 XDG 用户 source store、合并优先级和损坏配置错误。
- [ ] 新增内置 `rd-guide` descriptor，不包含 Application Secret。
- [ ] 实现 enable/disable 和 source CLI，验证惰性零网络。

### B. CredentialStore

- [ ] 定义公共接口和版本化 credential payload。
- [ ] 实现 memory adapter 与动态加载的 keyring adapter。
- [ ] 加入 `@napi-rs/keyring` optional dependency和平台不可用测试。
- [ ] 实现 credential key、结构校验、logout 和敏感日志清理。

### C. OAuth

- [ ] 实现 PKCE verifier/challenge/state、loopback server 和 token exchange。
- [ ] 实现 Device Flow 状态机、可注入 clock/sleep 和取消。
- [ ] 实现 expiry、单飞 refresh、scope 校验和重新授权。
- [ ] 实现 auth CLI 与非敏感 status 输出。

### D. GitLab Provider

- [ ] 实现 REST client、project URL 编码、Bearer 注入、超时与错误分类。
- [ ] 实现 index/tree/files/archive 读取和固定 commit 校验。
- [ ] 实现安全 archive 提取、subdir 隔离、canonical hash 和不可变缓存。
- [ ] 输出 P2 `PluginCandidate` 与标准包，不写目标项目。

### E. Search 与远端接入

- [ ] 实现远端 `plugin search` 和 JSON 输出。
- [ ] 把 GitLab provider 注册到 P2 registry；未引用时不构造请求。
- [ ] 通过 P2 application service 支持远端 add/update，不复制写盘逻辑。

### F. 验证

- [ ] 运行 OAuth、keyring、GitLab mock、缓存、archive 安全和零网络测试。
- [ ] 运行敏感字段扫描和完整 `npm test`。
- [ ] 执行真实 GitLab 人工 smoke test，仅报告状态，不保存 token 响应。

## 3. 文件所有权

- `src/plugin/auth/**`
- `src/plugin/sources/gitlab-provider.js`
- `src/plugin/sources/user-source-store.js`
- `src/plugin/sources/source-registry.js` 的用户级扩展
- `src/builtin-marketplaces/rd-guide.json`
- `src/commands/plugin.js` 的 source/auth/search 与远端接入
- `package.json`、`package-lock.json` 的 keyring optional dependency
- 对应 `test/js/plugin-gitlab-*.test.js`、`plugin-oauth-*.test.js`

## 4. 验证命令

```bash
node --test test/js/plugin-source-store.test.js
node --test test/js/plugin-credential-store.test.js
node --test test/js/plugin-oauth-pkce.test.js
node --test test/js/plugin-oauth-device.test.js
node --test test/js/plugin-gitlab-provider.test.js
node --test test/js/plugin-gitlab-archive.test.js
node --test test/js/plugin-remote-cli.test.js
npm test
npm pack --dry-run --json
git diff --check
```

## 5. 高风险检查点

- [ ] 不得保存或引用 Application Secret。
- [ ] token 不得进入 URL、argv、项目文件、cache metadata、JSON 输出或日志。
- [ ] scopes 固定 `read_repository read_api`，不申请 `api`。
- [ ] 未使用或禁用 `rd-guide` 时网络请求必须为 0。
- [ ] archive 在写缓存前完成路径、链接、subdir 和 digest 校验。
- [ ] keyring 不可用时只使用当前进程内存，不写明文 fallback。
- [ ] P3 不复制 resolver、transaction writer 或 capability policy。

## 6. 回滚点

- 远端失败时保持 GitLab source 不可用，builtin/local provider 正常运行。
- OAuth 失败只清理临时 callback/device 状态，不修改项目声明。
- 缓存发布前失败删除 staging；已验证的旧缓存不覆盖。
