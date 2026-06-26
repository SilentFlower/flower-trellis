# 保护 config.yaml 本地配置

## Goal

让 `flower-trellis update` 在用户选择 Trellis 上游冲突处理的 `Apply Overwrite to all` 后，仍能自动保留目标项目 `.trellis/config.yaml` 里的项目本地配置，优先解决 `packages` 与 `default_package` 被模板覆盖的问题，减少用户每次从 git 恢复配置的重复操作。

## Requirements

- 在 `flower-trellis update` 执行 `trellis update` 前，读取目标项目 `.trellis/config.yaml` 中需要保护的本地配置快照。
- 在 `trellis update` 与 flower 强化包叠加后，自动把被保护的配置合并回 `.trellis/config.yaml`。
- MVP 默认保护顶层 `packages` 与 `default_package`：
  - `packages` 用于保留 monorepo / submodule / git repo 包声明。
  - `default_package` 用于保留未指定 package 时的默认包。
- 合并必须幂等：重复执行 `flower-trellis update` 不应重复追加配置块，也不应破坏上游模板新增内容。
- 当目标项目没有 `.trellis/config.yaml`、没有被保护字段，或 `trellis update` 失败时，不应写入错误配置。
- 成功恢复配置时，CLI 输出应有简短提示，说明已保留的字段。
- 不能要求用户改成 `update.skip: [.trellis/config.yaml]` 才能避免覆盖；该方式只作为临时手动绕法。

## Acceptance Criteria

- [ ] 给定更新前 `.trellis/config.yaml` 包含 `packages` 与 `default_package`，即使更新过程中上游模板整文件覆盖了 `config.yaml`，`flower-trellis update` 结束后这两个字段仍保留原值。
- [ ] 给定更新后的上游模板新增其他配置段，保护逻辑不会用旧文件整块覆盖新模板，新增配置段仍保留。
- [ ] 给定更新前没有 `packages` / `default_package`，更新后不会凭空新增这些字段。
- [ ] 给定 `trellis update` 失败，保护逻辑不会继续修改 `.trellis/config.yaml`。
- [ ] 重复运行同一保护逻辑，文件不会产生重复的 `packages` / `default_package` 块。
- [ ] CLI 输出能看出是否恢复了被保护字段。

## Confirmed Facts

- `src/commands/update.js` 当前会先运行上游 `trellis update`，再调用 `applyEnhancements()` 叠加强化包。
- 上游 `trellis update` 把 `.trellis/config.yaml` 作为模板文件管理；用户选择 `Apply Overwrite to all` 时会整文件写入模板内容。
- 上游已有 `update.skip`，但它是按路径跳过整个 `.trellis/config.yaml`，无法同时获得模板新增配置与本地字段保留。
- `src/lib/codex-tweaks.js` 已经在强化包叠加阶段修改 `.trellis/config.yaml` 的 `codex.dispatch_mode`，说明 flower 层已有配置后处理入口。
- 本仓曾有提交恢复被 update 覆盖的 monorepo 配置，说明该问题已在真实 dogfood 场景出现。

## Notes

- 推荐设计方向：在 flower 层新增 `config.yaml` 保护工具，而不是修改全局 Trellis 安装或依赖用户跳过整个文件。
- 后续可考虑支持可配置保护列表，例如 `spec_scope`、`hooks`、`registry` 等；MVP 先避免过度扩大行为面。
