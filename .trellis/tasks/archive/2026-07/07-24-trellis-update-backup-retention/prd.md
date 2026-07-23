# 控制 Trellis 升级备份保留

## Goal

避免 `flower-trellis update` 每次调用上游 `trellis update` 后永久累计完整的
`.trellis/.backup-<timestamp>/` 快照，在保留可靠升级回滚能力的前提下，自动清理超过保留策略的旧备份。

## Background

- 上游 `trellis update` 会在写入前创建完整的 `.trellis/.backup-<timestamp>/` 快照，目前没有
  `--no-backup`、保留数量或自动清理参数。
- 当前仓库已有 6 份时间戳备份，每份约 2.6 MB，总计约 16 MB；最新两份只有 25 个文件存在差异，
  大部分内容重复。
- `.trellis/.backup-flower/` 是 Flower Patch Engine 保存的首次修改前基线，使用不同的恢复语义，
  不属于本任务的自动清理范围。
- `flower-trellis update` 在上游更新后还会恢复本地 `config.yaml` 配置并重新应用 enhancements，
  因此不能在整条 Flower 更新链路成功前删除当前或历史回滚点。

## Requirements

- R1：仅管理名称严格匹配 `.trellis/.backup-YYYY-MM-DDTHH-MM-SS` 的时间戳备份目录。
- R2：始终排除 `.trellis/.backup-flower/`、软链接、普通文件和其它相似名称路径。
- R3：删除前校验候选目录的真实路径仍位于目标项目的 `.trellis/` 内，禁止路径逃逸。
- R4：仅在上游更新和 Flower enhancements 成功、既有配置恢复流程执行完毕且主流程无异常后执行清理。
- R5：更新任一阶段失败时不清理旧备份，并保留本轮上游已经创建的回滚快照。
- R6：按时间从新到旧保留固定数量快照，只删除超出数量的最旧快照。
- R6.1：默认保留最近 3 份合法时间戳升级备份。
- R6.2：提供 Flower 自有参数 `--backup-retention <n>` 临时覆盖默认值；`n` 必须是非负整数，
  `0` 表示关闭本次自动清理。非法值必须在调用上游 Trellis 前失败且零写入。
- R6.3：本轮上游新创建的备份必须显式保护，即使系统时间回拨导致其名称排序较旧也不能被清理。
- R7：清理失败只输出中文警告，不把已经成功的更新改判为失败。
- R8：`--dry-run` 不删除任何目录，并展示预计保留与删除的备份。
- R9：若新增 Flower 自有 CLI 参数，必须加入 `OWN_FLAGS` 并由 `cli.js` 解析，不能透传给
  `trellis update`。
- R10：`--enhance-only` 不会创建上游升级备份，因此默认不触发时间戳备份清理。
- R11：保留策略是单次命令行为，不写入 `.trellis/.flower-manifest.json` 或项目配置；未传参数时
  始终使用默认值 3。
- R12：CLI help 与 README 必须说明默认值、`0` 的关闭语义、dry-run 行为和
  `.backup-flower` 不受影响。

## Acceptance Criteria

- [ ] AC1：存在多份合法时间戳备份时，成功更新后保留配置数量的最新备份；仅当本轮受保护备份
  数量或时间排序异常需要时允许临时超过配置数量。
- [ ] AC2：`.backup-flower`、非法名称、文件和软链接均不会被删除。
- [ ] AC3：路径逃逸候选被拒绝并输出警告，项目外零写入。
- [ ] AC4：上游更新或 enhancements 抛错时不删除任何旧备份；未来配置恢复若改为抛错，清理也必须跳过。
- [ ] AC5：清理自身发生单个目录删除失败时继续处理并汇总警告，更新命令保持成功状态。
- [ ] AC6：dry-run 输出稳定的计划结果，文件系统保持不变。
- [ ] AC7：CLI 解析和上游透传测试证明 Flower 自有参数不会进入 Trellis 参数列表。
- [ ] AC8：现有 `.backup-flower` 首次备份和 Patch Engine 测试保持不变。
- [ ] AC9：本轮新增备份在时间排序异常时仍被保留，超额清理不得突破显式保护集合。
- [ ] AC10：`--backup-retention 0`、负数、非整数和缺失取值分别得到明确且稳定的行为。

## Out Of Scope

- 修改上游 `@mindfoldhq/trellis` 的快照创建机制。
- 使用硬链接、压缩包或内容寻址存储对备份去重。
- 自动删除 `.trellis/.backup-flower/` 或迁移其首次基线语义。
- 自动恢复升级备份。
