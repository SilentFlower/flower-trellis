# Release Operations

## Conclusion

Release operations exist. 本任务引入内置 `rd-guide` GitLab Marketplace 和 GitLab OAuth 公共客户端配置，发布后需要确认目标 GitLab Application 与只读 REST/Git 权限可用。

## Evidence Checked

- task.json
- prd.md
- design.md
- implement.md
- check.jsonl / implement.jsonl
- git commit `3688744`
- src/builtin-marketplaces/rd-guide.json

## Drift Check

Missing release.md. 新增本文件记录 GitLab OAuth 与 Marketplace 的发布核对事项。

## SQL Changes

None

## Configuration Changes

- `[07-28-flower-plugin-gitlab-marketplace]` `src/builtin-marketplaces/rd-guide.json` 随包内置 `rd-guide` 来源，目标为 `http://gitlab.xhgjdev.com/digital-rd-governance/rd-guide`，OAuth Application ID 为 `0f73e53d745450b6ab9596960b10a2ac1654d67c0941bae381f6dbbf6839ec04`。
- `[07-28-flower-plugin-gitlab-marketplace]` GitLab Application 必须允许公共客户端登录，不需要也不得分发 Application Secret；scope 需要包含 `read_repository` 与 `read_api`，以覆盖 Git-over-HTTP、Repository Files、`repository/tree` 和 archive 读取。

## Batch / Deployment Scripts / Data Repair

None

## External Systems / Dependent Platforms

- `[07-28-flower-plugin-gitlab-marketplace]` 发布后使用真实 GitLab 账号重新执行一次 `rd-guide` 授权与 Marketplace 读取 smoke test，确认 token-info、Git-over-HTTP、`repository/tree` 与 archive 均可读，写 API 不在实现中使用。
- `[07-28-flower-plugin-gitlab-marketplace]` 如目标 GitLab Application、项目路径、Marketplace path 或权限配置变化，需要同步更新 `src/builtin-marketplaces/rd-guide.json` 后再发布。

## Release Order

No special order.

## Rollback Notes

Rollback code only. 回退本任务代码后，GitLab 远端来源能力不可用，但 builtin/local Plugin provider 仍可继续工作。

## Post-release Verification

- 运行 Plugin 远端来源相关测试或等价 smoke test。
- 用真实 GitLab 登录验证 `rd-guide` 搜索/读取链路；确认 token、refresh token、authorization code 和 Authorization header 未进入项目文件、缓存元数据、JSON 输出或日志。
