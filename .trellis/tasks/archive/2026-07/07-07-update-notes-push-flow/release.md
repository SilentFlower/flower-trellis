# Release Operations

## Conclusion
Release operations exist.

本任务修改了 flower-trellis 的发布链路、npm package metadata 和 release notes 生成逻辑。代码已提交并推送，但功能对最终用户生效还需要后续发版。

## Evidence Checked
- task.json
- prd.md
- design.md / implement.md / implement.jsonl / check.jsonl
- release.md: 原先不存在
- git commits / changed files:
  - `bbdb23c feat(update): 注入跨版本更新摘要并联动 push 确认`
  - `363dd9b feat(0.6): 增加 flower 更新确认兜底`
  - `package.json`
  - `scripts/write-release-notes-metadata.mjs`
  - `scripts/lib/changelog-section.mjs`
  - `scripts/extract-changelog.mjs`
  - `src/lib/update-check.js`
  - `src/lib/self-check.js`
  - `src/lib/manifest.js`
  - `src/commands/self-update.js`
  - `src/assets/flower_update_hook.py`
  - `enhancements/MANIFEST.json`
  - `vendor/skill-garden`

## Drift Check
Missing release.md. 新增本文件记录本任务的发布操作要求。

## SQL Changes
None. 已核对任务范围和变更文件,不涉及数据库、SQL 或 migrations。

## Configuration Changes
- `package.json` 增加 `commit-and-tag-version.scripts.postchangelog`,真实 release 时会运行 `node scripts/write-release-notes-metadata.mjs`。
- release commit 会把当前版本 CHANGELOG 段写入 `package.json.flowerReleaseNotes`;该字段会进入 npm registry 对应版本 metadata。
- `.trellis/.flower-manifest.json` 已因本地项目 self-update 刷新 `flowerVersion` 到当前工具版本;这是项目状态同步,不是运行环境配置。

## Batch / Deployment Scripts / Data Repair
- 发版前必须按 `.trellis/spec/flower-trellis/cli/release-and-publishing.md` 执行 dry-run 预览,展示将生成的版本号和 CHANGELOG 段落并等待确认。
- 真实 release 前必须先运行 `npm run sync`;若产生 `enhancements/` diff,先提交快照并通过 `node scripts/check-snapshot.mjs`。
- 真实 release 使用与 dry-run 相同的版本策略参数运行 `npm run release...`;该命令会生成 release commit 和 tag,但不 push、不 publish。
- 推送 tag 后由 GitHub Actions 发布到 npm;beta 版本必须走 `npm publish --tag beta`,稳定版走 `latest`。

## External Systems / Dependent Platforms
- npm registry: 新版本发布后需要确认 `flowerReleaseNotes` 随对应版本 metadata 可读取。
- GitHub Actions / GitHub Releases: tag push 会触发 `.github/workflows/release.yml`,并创建对应 GitHub Release 或 prerelease。
- `vendor/skill-garden` 已先推送 `363dd9b`,父仓 `enhancements/MANIFEST.json.sourceCommit` 已同步到该 commit。

## Release Order
1. 确认父仓和 `vendor/skill-garden` 工作区干净。
2. 运行与目标版本策略一致的 `npm run release:dry...`,展示版本号和 CHANGELOG 段落并等待确认。
3. 运行 `npm run sync`,检查并提交任何新的快照变化。
4. 运行 `node scripts/check-snapshot.mjs`。
5. 运行真实 `npm run release...`。
6. 检查 release commit / tag diff。
7. `git push --follow-tags origin main`。
8. 等待 GitHub Actions 发布完成。

## Rollback Notes
- 未推送 tag 前: 回滚本地 release commit 和 tag。
- tag 已推送但 npm 发布未成功: 删除/修正 tag 后重新按 release SOP 执行。
- npm 已发布后: 不要删除已发布版本;发布后续 patch 版本回滚代码或修复 release metadata。
- 代码级回滚参见 `design.md` 的 Rollback 段落。

## Post-release Verification
- `npm view flower-trellis version` 或 `npm view flower-trellis dist-tags --json` 确认目标通道版本。
- `npm view flower-trellis@<version> flowerReleaseNotes --json` 确认 metadata 存在且 `version` 匹配。
- 对 beta 发版,确认 dist-tag 是 `beta`,没有污染 `latest`。
- 在测试项目运行 `flower-trellis self-check --json --force-remote --target <project>` 验证 `releaseNotes` 输出。
- 启动 Codex / Claude Code SessionStart hook,验证 `<flower-update>` 提示包含摘要、推荐命令和确认要求。
