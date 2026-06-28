# 保护 config.yaml 本地配置 - Design

## Architecture

在 flower 层新增一个 `src/lib/config-preserver.js` 模块，职责是保护目标项目 `.trellis/config.yaml` 中少量项目本地顶层配置。`src/commands/update.js` 负责在上游 `trellis update` 前创建快照，并在上游更新与 `applyEnhancements()` 后恢复。

建议流程：

1. `update(ctx)` 开始时调用 `captureConfigPreserveSnapshot(target)`。
2. 继续执行 `syncGlobalTrellis()` 与上游 `trellis update`。
3. 如果上游 `trellis update` 失败，直接抛错，不恢复配置，避免在失败状态下继续写文件。
4. `applyEnhancements()` 完成后调用 `restoreConfigPreserveSnapshot(target, snapshot)`。
5. 若发生恢复，打印 `  ✓ config.yaml 已保留本地配置: packages, default_package`。

## Data Flow

输入文件：

- 更新前：目标项目 `.trellis/config.yaml`
- 更新后：被上游 Trellis 与 flower 后处理修改过的 `.trellis/config.yaml`

快照内容：

- `packages` 顶层 YAML 块的原始文本。
- `default_package` 顶层 YAML 块的原始文本。

恢复规则：

- 只恢复更新前存在的字段。
- 如果更新后文件中已有同名顶层 key，替换该顶层块。
- 如果更新后文件中没有同名顶层 key，则追加到文件末尾。
- 不使用旧文件整文件覆盖新文件，避免丢失上游模板新增配置段。

## YAML Handling

MVP 不引入 YAML 依赖，沿用本仓现有轻量文本处理风格：

- 识别“未注释且无缩进”的顶层 key：`packages:` / `default_package:`。
- 顶层块范围从 key 所在行开始，到下一个未注释顶层 key 前结束。
- 注释与空行归属当前块；这能保留用户给 `packages` 附近写的业务说明。
- 恢复时以原始文本块为准，最大限度保留用户缩进、注释和字段顺序。

风险控制：

- 只处理固定白名单 key，不扫描或改写未知配置。
- 文件不存在、快照为空、写入前后内容相同都直接跳过。
- 解析失败不抛出主流程；返回空快照或未恢复结果。

## Compatibility

- 对 `flower-trellis init` 无影响；只接入 `update`。
- 对 `--dry-run`：上游 dry-run 不应实际覆盖模板，恢复逻辑通常无改动；如果 flower 后处理有写入，恢复也保持幂等。
- 对 `--enhance-only`：此模式跳过上游 `trellis update`，但仍可保护 `applyEnhancements()` 里的后处理，行为安全。
- 对没有 `.trellis/config.yaml` 的目标项目：不写入。

## Trade-offs

- 不直接使用 `update.skip`：它只能跳过整个文件，无法同时保留上游模板新增段。
- 不在 MVP 做用户可配置保护列表：先固定 `packages` 与 `default_package`，降低误保留旧配置的风险。
- 不引入 `yaml` 依赖：尽管 lockfile 中间接存在 `yaml` 包，但 `package.json` 未声明直接依赖；新增直接依赖会扩大发布面。当前需求只需顶层块原样保留，文本块处理更合适。

## Rollback

若实现引发问题，可以从 `src/commands/update.js` 移除快照与恢复调用，并删除 `src/lib/config-preserver.js`。该功能不改变目标项目持久状态格式，也不引入迁移。
