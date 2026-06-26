# Brief — 保护 config.yaml 本地配置

## Goal

- 让 `flower-trellis update` 在用户选择 Trellis 上游 `Apply Overwrite to all` 后，仍自动保留目标项目 `.trellis/config.yaml` 中的 `packages` 与 `default_package` 本地配置。

## Scope

- 新增 flower 层 `config.yaml` 保护逻辑，在上游 `trellis update` 前捕获配置快照，并在上游更新与 `applyEnhancements()` 后恢复。
- MVP 固定保护顶层 `packages` 与 `default_package`。
- 恢复时替换或追加对应顶层 YAML 块，保留上游模板新增配置段。
- CLI 在发生恢复时输出简短提示。

## Non-Goals

- 不要求用户通过 `update.skip` 跳过整个 `.trellis/config.yaml`。
- 不修改全局 Trellis 安装或 `node_modules/@mindfoldhq/trellis`。
- 不在 MVP 引入用户可配置保护列表。
- 不为该功能新增 YAML 直接依赖。

## Key Context

- `src/commands/update.js` 当前先运行上游 `trellis update`，再执行 `applyEnhancements()`。
- 上游 `trellis update` 把 `.trellis/config.yaml` 作为模板文件管理，`Apply Overwrite to all` 会整文件覆盖。
- `src/lib/codex-tweaks.js` 已有 flower 层配置后处理入口，可作为风格参考。
- 新模块建议为 `src/lib/config-preserver.js`，只处理固定白名单顶层 key，失败时降级跳过。
- 必须保持上游 `trellis update` 失败即中止，不在失败状态下继续写配置。

## Acceptance

- 更新前存在 `packages` 与 `default_package` 时，更新后仍保留原值。
- 更新后模板新增的其他配置段不会被旧文件整块覆盖掉。
- 更新前没有被保护字段时，不会凭空新增。
- 上游 `trellis update` 失败时，不继续修改 `.trellis/config.yaml`。
- 重复运行保护逻辑不会产生重复块。
- CLI 输出能看出恢复了哪些字段。

## Next Step

- 等用户确认 planning artifacts 与本 brief 后，运行 `task.py start` 进入实现阶段。
