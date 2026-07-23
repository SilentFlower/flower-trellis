# Release Operations

## Conclusion

Release operations exist.

## Evidence Checked

- `task.json`
- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`
- flower-trellis business commit `cead9c0`
- task progress commit `fb3c0d6`
- Current Git status and branch/upstream state

## Drift Check

Missing `release.md`;README 和 CLI help 已记录默认保留 3 份升级备份，但设计要求的发布说明尚未写入 CHANGELOG。

## SQL Changes

None.

## Configuration Changes

None. `--backup-retention` 是单次 CLI 参数，不写入项目配置、manifest 或环境变量。

## Batch / Deployment Scripts / Data Repair

- 在发布包含本任务的 flower-trellis 版本前，把“成功更新后默认只保留最近 3 份 Trellis 时间戳备份，`--backup-retention 0` 可关闭清理”写入对应 CHANGELOG / release notes。
- 无数据库脚本、数据修复或一次性后台任务。

## External Systems / Dependent Platforms

None.

## Release Order

1. 先补充包含默认行为变化和关闭方式的 CHANGELOG / release notes。
2. 再按项目既有发布流程执行版本发布。

## Rollback Notes

回滚代码时移除 update 编排、CLI 参数和备份清理 helper；不要删除或迁移用户现存的备份目录。

## Post-release Verification

- 验证 `flower-trellis update --dry-run` 展示默认保留 3 份的清理计划且不删除文件。
- 验证 `flower-trellis update --backup-retention 0` 保留全部升级备份。
- 验证 `.trellis/.backup-flower/` 和本轮新建的时间戳备份不受误删。
