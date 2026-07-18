# Release Operations

## Conclusion

Release operations exist. `v0.5.0-beta.0` 已发布完成，当前无剩余人工上线动作。

## Evidence Checked

- `task.json`
- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`
- flower-trellis commits `64f06ac`、`05e71e3`、`7c3b807`
- skill-garden commit `3e9f2d3`
- Git tag `v0.5.0-beta.0` 与 `origin/beta`
- npm `beta` dist-tag 和 `flower-trellis@0.5.0-beta.0`

## Drift Check

Missing `release.md`;任务材料、Git 提交、远端 tag 与 npm registry 证据一致，未发现发布漂移。

## SQL Changes

None

## Configuration Changes

None

## Batch / Deployment Scripts / Data Repair

- `[07-18-task-intent-routing]` 发布前按顺序执行 `npm run sync` 和 snapshot 一致性检查；已完成。
- `[07-18-task-intent-routing]` 推送 `v0.5.0-beta.0` tag，由 GitHub Actions 发布 npm `beta`；已完成。
- 无数据库脚本、数据修复或一次性后台任务。

## External Systems / Dependent Platforms

- `[07-18-task-intent-routing]` npm registry：`flower-trellis@0.5.0-beta.0` 已发布，`beta` dist-tag 已指向该版本。
- `[07-18-task-intent-routing]` GitHub Actions / GitHub Release：由 `v0.5.0-beta.0` tag 触发发布链路；远端 tag 已核对。

## Release Order

1. skill-garden `beta` 提交并推送 `3e9f2d3`。
2. flower-trellis 同步 submodule pin、生成 snapshot 并提交 `64f06ac`、`05e71e3`。
3. flower-trellis 生成并推送 release commit/tag `7c3b807` / `v0.5.0-beta.0`。

以上顺序已完成；flower-trellis 引用的 skill-garden commit 已在远端可达。

## Rollback Notes

回滚必须保持 skill-garden 源、flower-trellis submodule pin、快照和执行器配对；通过后续 beta 版本恢复，不单独回退其中一个仓库。

## Post-release Verification

- 验证 `npm view flower-trellis@0.5.0-beta.0 version` 返回 `0.5.0-beta.0`。
- 验证 npm `beta` dist-tag 指向 `0.5.0-beta.0`。
- 验证项目 self-update 后 Flower `0.5.0-beta.0`、Trellis `0.6.5` 且无 out-of-sync。
- 按任务 AC1-AC15 验证意图路由、声明式变换、discard 安全、幂等和上下文预算检查。
