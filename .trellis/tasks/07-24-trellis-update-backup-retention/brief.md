# Brief — 控制 Trellis 升级备份保留

## Goal

- 在保留可靠升级回滚能力的前提下，自动清理 `flower-trellis update` 累计的旧
  `.trellis/.backup-<timestamp>/` 快照，默认只保留最近 3 份。

## Scope

- 新增 Flower 自有参数 `--backup-retention <n>`：默认 3，正整数覆盖保留数量，`0` 关闭本次清理，
  非法值在任何升级副作用前失败。
- 新增独立的时间戳备份发现、保留规划和安全删除 helper，只处理严格匹配
  `.backup-YYYY-MM-DDTHH-MM-SS` 的 `.trellis/` 直接子目录。
- 在 `flower-trellis update` 的上游 update、enhancements 和既有配置恢复流程结束且主流程无异常后
  执行清理；dry-run 只展示计划。
- 更新 CLI help、README、聚焦单元测试、CLI/编排契约测试和 self-update 参数转发测试。

## Non-Goals

- 不修改上游 `@mindfoldhq/trellis` 的备份创建机制或依赖版本。
- 不删除或迁移 `.trellis/.backup-flower/` 的 Flower 首次基线。
- 不引入硬链接、压缩包、内容寻址去重、自动恢复或持久化项目配置。
- 不修改 vendor/skill-garden 或 enhancements 快照。

## Key Context

- 当前仓库已有 6 份时间戳备份，每份约 2.6 MB，总计约 16 MB；最新两份仅 25 个文件不同。
- `src/commands/update.js` 是清理调用时机的 owner；调用必须位于既有 `try/finally` 之后，异常路径不得清理。
- `src/lib/update-backups.js` 将成为删除安全边界：严格名称、直接子目录、`Dirent`、`lstat`、`realpath`
  和 `path.relative` 多重校验，候选或 `.trellis` 路径逃逸时零删除并警告。
- 更新前后备份集合差值形成 protected 集合，防止系统时间回拨时误删本轮新回滚点；必要时允许临时超过保留数量。
- 单项删除失败记录中文 warning 并继续，不把已成功的升级改判为失败。
- 参数原始值进入 `ctx.backupRetention`，在 `update()` 入口校验；`OWN_FLAGS` 必须登记，禁止透传 Trellis。
- `self-update -- --backup-retention <n>` 复用现有 forwarded 链路进入项目 Flower update。
- `--enhance-only` 和 retention=0 不扫描、不清理；`--no-enhance` 在 Trellis update 成功后仍清理。

## Acceptance

- 成功更新后保留配置数量的最新合法备份，受保护的新备份不因排序异常被删除。
- `.backup-flower`、非法名称、普通文件、软链接和项目外路径均不被删除。
- 上游 update 或 enhancements 抛错时不清理；未来配置恢复若抛错同样跳过。
- dry-run 输出稳定计划且文件系统不变；单项删除失败继续处理并保持更新成功。
- `--backup-retention 0`、缺失值、负数、小数和非数字都有明确、稳定、零副作用的行为。
- CLI 参数不会进入 Trellis passthrough，现有 Patch Engine 首次备份测试保持通过。
- 聚焦测试、完整 `npm test` 和 `git diff --check` 全部通过。

## Next Step

- 用户确认本 brief 后运行 `task.py start`，再通过 `trellis-route(target=implement)` 进入实现。
