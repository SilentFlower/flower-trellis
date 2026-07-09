# 迁移 updateCheck 运行缓存到 tmp - 实施计划

## Checklist

1. 修改 `src/lib/manifest.js`。
   - 新增 `.trellis/.flower-update-check.tmp` 路径 helper。
   - 拆出策略字段和缓存字段归一化。
   - `readUpdateCheck()` 返回 manifest 策略 + tmp 缓存；tmp 缺失时 fallback 到旧 manifest 缓存字段。
   - `writeUpdateCheck()` 将策略字段写 manifest、缓存字段写 tmp，并清理旧 manifest 缓存字段。
   - `writeManifest()` 只保留策略字段，清理旧缓存字段。
2. 检查 `src/lib/self-check.js` 和 `src/lib/update-check.js` 的写缓存路径。
   - 确认所有缓存写入仍集中走 `writeUpdateCheck()`。
   - 更新误导性注释，避免继续说缓存写入 manifest。
3. 修改 `src/commands/update-check.js`。
   - `get` 输出 manifest 路径和 cache tmp 路径。
   - 命令注释改为管理策略并展示缓存。
4. 更新 README。
   - 说明策略保存在 `.flower-manifest.json`，运行缓存保存在 `.flower-update-check.tmp`。
   - 示例拆成 manifest JSON 和 tmp JSON。
5. 更新 `.trellis/spec/flower-trellis/cli/config-and-state.md`。
   - 修改 Install Manifest、Startup Self-Update Check、错误矩阵和验证建议。
   - 明确旧字段清理规则。
6. 验证。
   - `node --check src/lib/manifest.js src/lib/self-check.js src/lib/update-check.js src/commands/update-check.js`
   - 构造临时 Trellis 目标，写入旧格式 manifest，调用 `readUpdateCheck()` / `writeUpdateCheck()` 验证 fallback 和清理。
   - 验证缓存写入落到 `.trellis/.flower-update-check.tmp`，并确认该文件不会被 git 跟踪。
   - 运行 `flower-trellis update-check get --target <tmp-target>` 查看输出。
   - `git diff --check`

## Risk Points

- `readUpdateCheck()` 读取时不能写盘，否则 SessionStart 只读检查会制造副作用。
- `writeUpdateCheck()` 混合 patch 需要正确拆分字段，不能因为缓存写入丢失用户策略。
- 旧 manifest fallback 只能作为兼容读取来源，不能在 sanitize 后重新写回缓存字段。
- `lastReleaseNotes` 结构较复杂，必须复用现有归一化逻辑。
- 目标 manifest 不存在时不能因为写缓存而创建半截 manifest。

## Rollback Points

- 如果迁移导致 self-check 异常，优先回滚 `src/lib/manifest.js` 的读写拆分。
- `.trellis/.flower-update-check.tmp` 是 ignored 缓存，可直接删除。
- 如果 README/spec 更新与实现不一致，以实现后的验证结果修正文档，不保留旧“策略和缓存统一在 manifest”的说法。
