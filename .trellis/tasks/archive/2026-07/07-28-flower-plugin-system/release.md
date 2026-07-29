# Release Operations

## Conclusion

Release operations exist. 本任务完成 Flower Plugin 体系改造，发布前需要确认随包内置的 GitLab Marketplace 配置、OAuth 只读权限、可选 keyring 依赖和 `.flower/` 新状态模型的回滚边界。

## Evidence Checked

- task.json
- prd.md
- design.md
- implement.md
- research/current-architecture.md
- child task artifacts
- git commits `3c664c3`, `0d7c5b1`, `3688744`, `32ec993`, `2e9fd18`, `4e34b87`, `3db8320`, `8701039`, `4699a22`
- src/builtin-marketplaces/rd-guide.json
- package.json

## Drift Check

Missing release.md. 新增本文件记录整套 Plugin 体系的发布核对事项。

## SQL Changes

None

## Configuration Changes

- `[07-28-flower-plugin-system]` 随包内置 `rd-guide` GitLab Marketplace descriptor，目标 GitLab 为 `http://gitlab.xhgjdev.com/digital-rd-governance/rd-guide`，OAuth Application ID 为 `0f73e53d745450b6ab9596960b10a2ac1654d67c0941bae381f6dbbf6839ec04`。
- `[07-28-flower-plugin-system]` GitLab OAuth scope 需要包含 `read_repository` 与 `read_api`；不使用、不保存、也不分发 Application Secret。
- `[07-28-flower-plugin-system]` `@napi-rs/keyring` 是 optional dependency；目标环境无法安装或不可用时只允许进程内 token，不允许明文持久化回退。

## Batch / Deployment Scripts / Data Repair

None

## External Systems / Dependent Platforms

- `[07-28-flower-plugin-system]` 发布前确认 GitLab Application、项目路径和 Marketplace path 仍有效，且 `repository/tree` 与 archive REST 端点在 `read_api` scope 下可读。
- `[07-28-flower-plugin-system]` GitHub 公共仓库来源无需登录；发布后需至少用一个公开 GitHub Plugin 仓库 smoke test 自动识别、选择入口和安全解包。

## Release Order

No special order.

## Rollback Notes

Rollback code only. 旧 `.trellis/.flower-manifest.json` 不被删除，`.flower/` 新状态和事务目录可作为回滚证据；若用户已在项目内生成 `.flower/` 文件，回滚前应保留这些文件用于诊断。

## Post-release Verification

- 运行完整 Plugin 相关测试或等价 smoke test，覆盖 builtin/local/GitLab/GitHub、安装/更新/卸载/verify 和权限拒绝路径。
- 真实 GitLab smoke test 需要验证 PKCE 或 Device Flow、token-info、Git-over-HTTP、`repository/tree` 与 archive 均可读，并确认写 API 未使用。
- 验证 token、refresh token、authorization code、Application Secret 和 Authorization header 不进入项目文件、缓存元数据、JSON 输出或日志。
