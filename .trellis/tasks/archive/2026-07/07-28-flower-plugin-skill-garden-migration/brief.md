# Brief — 内置 skill-garden 与旧 CLI 迁移

## Goal

- 将现有 enhancement 成功链迁移为 `flower/skill-garden` 内置 system Plugin，并保持 init/update/uninstall 与既有安装结果兼容。

## Scope

- 内置 manifest 和读取现有 `enhancements/<variant>` 的 payload adapter。
- `applyEnhancements()` facade、init 默认声明、update lock replay。
- 旧 `.flower-manifest.json` 只读迁移和单一 `.flower/` 成功状态。
- update-check/self-check 新状态位置与旧读取兼容。
- uninstall 按 state ownership/hash 清理。

## Non-Goals

- 不搬迁 enhancement 快照，不实现 GitLab、作者工具或外部 CI，不移除旧 CLI 兼容参数。

## Key Context

- 完整 init 默认安装 skill-garden；独立 plugin add 不隐式安装。
- 保持 existing local operation ID、marker、provenance 和最终字节。
- 不允许旧 manifest 与新 state 双写；迁移失败保留旧证据和目标原状。
- update 不升级外部 Plugin；uninstall 不删除其它 Plugin、共享或用户修改路径。

## Acceptance

- old/0.5/0.6 新旧最终树和 provenance 对比一致。
- init、update、迁移、update-check、self-check、uninstall 与重复执行有测试。
- `--no-enhance`、`--enhance-only` 和无隐式 skill-garden 行为符合兼容契约。
- snapshot、Patch、compiled targets、context budget 和完整测试通过。

## Next Step

- P2/P4 验收后先实现 builtin adapter和 facade，再迁移状态与各旧 CLI 入口。
