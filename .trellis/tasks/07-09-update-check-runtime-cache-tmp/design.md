# 迁移 updateCheck 运行缓存到 tmp - 设计

## Architecture

持久化拆成两层：

- 策略层：`.trellis/.flower-manifest.json` 的 `updateCheck` 只保存 `enabled`、`policy`、`intervalHours`。
- 缓存层：`.trellis/.flower-update-check.tmp` 保存 `lastCheckedAt`、`lastRemote`、`lastReleaseNotes`、`lastStatus`、`lastErrorCode`。

对外 API 尽量保持不变：`readUpdateCheck(target)` 返回策略和缓存合并后的对象，现有 `self-check` 和 `update-check get` 可以继续按完整对象工作。内部新增拆分 helper 负责策略归一化、缓存归一化、缓存路径定位和 manifest 清理。

## Data Flow

### 读取

1. 读取 `.trellis/.flower-manifest.json`。
2. 从 manifest 的 `updateCheck` 归一化策略字段。
3. 读取 `.trellis/.flower-update-check.tmp` 并归一化缓存字段。
4. 如果 tmp 缺失或损坏，则从旧 manifest 的缓存字段构造 legacy fallback。
5. 返回 `{ ...policy, ...cache }` 的兼容视图。

读取本身不写盘，避免 SessionStart hook 在只读检查中产生副作用。

### 写入策略

`writeUpdateCheck(target, patch)` 接收混合 patch 时先拆字段：

- 策略字段写回 manifest。
- 缓存字段写入 tmp。
- 写 manifest 时始终 sanitize `updateCheck`，清除旧缓存字段。

`update-check set|disable|enable` 只传策略字段，因此只会更新 manifest 并清理旧缓存。

### 写入缓存

`self-check`、`checkForUpdate()` 和 release notes 补拉继续调用 `writeUpdateCheck()`。当 patch 只包含缓存字段时：

1. 目标 manifest 存在时，缓存写入 `.trellis/.flower-update-check.tmp`。
2. 如果旧 manifest 中仍有缓存字段，则顺带写回一次 sanitized manifest，把旧字段删掉。
3. 之后同类缓存刷新只修改 tmp，不再触碰 manifest。

目标 manifest 不存在时不创建 manifest；缓存写入也跳过或降级为无副作用，保持现有“无 manifest 不凭空创建半截 manifest”的边界。

### 全装 / update 写 manifest

`writeManifest(target, data)` 保留当前 manifest 或输入 data 中的策略字段，但只写策略字段，不写缓存字段。旧 manifest 中的缓存字段会在下一次全装 / update / self-update project-only 路径中被清掉。

## Compatibility

- 旧项目已有 `lastCheckedAt` 等字段时，新版本第一次读取仍能使用这些缓存，避免 interval 失效导致立即联网。
- 第一次写入会进行一次性清理，这会产生一个合理的 manifest diff；后续缓存变化只在 ignored tmp 文件中发生。
- `update-check get` 保持展示完整对象，降低用户理解成本；同时输出 manifest 和 tmp 路径，说明哪些内容会进 git、哪些不会。
- `.trellis/.flower-update-check.tmp` 不是权威配置，删除后只会丢失节流和 release notes 缓存，不影响用户策略。

## Files

- `src/lib/manifest.js`：新增 tmp 路径、策略 / 缓存拆分归一化、legacy fallback、写入拆分和旧字段清理。
- `src/lib/self-check.js`：大概率无需改业务逻辑，只需确认写缓存仍通过 `writeUpdateCheck()`。
- `src/lib/update-check.js`：大概率无需改业务逻辑，只需更新注释中“manifest 缓存”的表述。
- `src/commands/update-check.js`：`get` 输出增加 cache tmp 路径；命令说明从“manifest 内策略”改为“manifest 策略 + tmp 缓存”。
- `README.md`：更新持久化说明和示例。
- `.trellis/spec/flower-trellis/cli/config-and-state.md`：更新项目规范，记录新状态契约和迁移规则。

## Rollback

回滚代码后，旧版本会重新只读写 manifest 中的完整 `updateCheck`。由于 tmp 只是缓存文件，删除 `.trellis/.flower-update-check.tmp` 即可回到旧行为；已清理的 manifest 缓存会按旧版本后续运行重新生成。
