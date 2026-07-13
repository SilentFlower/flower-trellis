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
- `release.md`（原先不存在）
- 工作提交 `8b36bc7 feat(skill): 自动同步已启用的 common skill`
- 快照提交 `88efbc2 chore(task): update common-skill-auto-update push snapshot`
- 变更文件：`src/lib/skill-catalog.js`、`src/lib/apply-enhancements.js`、
  `scripts/sync-enhancements.mjs`、`enhancements/MANIFEST.json`、README 与项目规范

## Drift Check

Missing release.md. 已根据任务和提交证据补齐。

## SQL Changes

None.

## Configuration Changes

None.

## Batch / Deployment Scripts / Data Repair

- 按项目发布流程发布新的 `flower-trellis` npm 版本：先运行对应的
  `npm run release:dry` 并确认 CHANGELOG，再运行 `npm run sync`、审核并提交可能产生的
  `enhancements/` 快照变化，通过 `node scripts/check-snapshot.mjs` 后执行正式 release。
- 将 release commit 与 tag 使用 `git push --follow-tags origin main` 推送，由
  `.github/workflows/release.yml` 发布 npm 包并创建 GitHub Release。

## External Systems / Dependent Platforms

- npm registry：必须发布包含新版 `enhancements/MANIFEST.json` 和运行时代码的
  `flower-trellis` 新版本，用户升级后 common skill 自动更新逻辑才会生效。
- GitHub Releases：由 release tag 触发 CI 创建对应版本发布记录。

## Release Order

1. 确认 `main` 包含 `8b36bc7` 与后续任务 bookkeeping 提交，且工作区干净。
2. 按 `release-and-publishing.md` 完成 dry-run、快照同步与检查门禁。
3. 创建 release commit/tag 并推送。
4. 等待 npm 与 GitHub Release 流程完成后执行发布后验证。

## Rollback Notes

- 未发布前可回退工作提交并重新生成快照。
- 已发布后不要覆盖或 force push 已发布 tag；通过后续修复版本回退自动同步行为，必要时在
  npm 标记问题版本并通知用户暂缓升级。

## Post-release Verification

- 使用 `npm view flower-trellis version` 确认 npm registry 已发布目标版本。
- 在临时 Trellis 项目安装最新版，准备一个已启用 common skill、一个未启用 common skill
  和一个历史 tombstone skill，执行 `flower-trellis update`。
- 验证已启用项被新版快照覆盖、未启用项没有安装、tombstone 项被删除，并确认重复更新幂等。
