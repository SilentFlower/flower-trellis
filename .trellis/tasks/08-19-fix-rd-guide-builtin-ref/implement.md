# Implementation Plan

## 1. 核对任务基线

- [x] 确认当前分支为 `beta`，upstream 为 `origin/beta`，记录初始 `HEAD` 与工作区状态。
- [x] 确认任务范围内只有 `src/builtin-marketplaces/rd-guide.json`、`test/js/plugin-source-store.test.js` 和本任务材料；不吸收其它窗口改动。
- [x] 核对 `3688744` 与 `4ba3cf6` 的文件历史，确认 `main` 是恢复原值且 `https` 不回退。

## 2. 验证现有代码改动

- [x] 检查 builtin descriptor 仅把 `ref` 改为 `main`。
- [x] 检查测试同步两处 `ref` 断言，并把旧用户 fixture 改为 `legacy-branch`。
- [x] 运行 `git diff 3688744 -- src/builtin-marketplaces/rd-guide.json`，确认只剩 `baseUrl` 的 `http` → `https` 差异。
- [x] 运行 `node --test test/js/plugin-source-store.test.js`。
- [x] 用可恢复临时补丁同时移除 `#readUserSources()` 的 builtin 裁剪和 `list()` 的 builtin 合并，确认目标用例失败；恢复后重新运行并确认通过。
- [x] 确认 `src/plugin/sources/user-source-store.js` 无任务外残留 diff。
- [x] 运行 `npm test` 与 `git diff --check`。

## 3. 质量检查与业务提交

- [x] 进入 `trellis-route(target=check)` 执行 Check-All，修复所有阻断问题后重新验证。
- [x] 执行 Update-Spec 判定；仅在形成可复用项目契约时更新规范，否则记录 no-op。
- [x] 通过 `trellis-push` 按精确文件范围提交任务代码与任务记录，并推送 `beta` 到 `origin`。

## 4. 任务完成后的发布交接

- 本节不参与当前 task 的完成态；当前 task 通过第 3 节的 `trellis-push` 完成后，立即按独立发布流程继续。
- 确认 `vendor/skill-garden` 工作区干净，当前 pin 与 `enhancements/MANIFEST.sourceCommit` 一致。
- 运行 `npm run sync`；若产生快照变化，按独立 `chore(snapshot):` 提交规则处理。
- 运行 `node scripts/check-snapshot.mjs`，再执行 `npm run release:dry -- --prerelease beta`。
- 展示 dry-run 生成的版本号和完整 CHANGELOG 段落，核对普通说明条目为中文，然后等待 owner 对真实 release 的明确确认。

## 5. 后续真实 beta 发布与回读

- 仅在 owner 明确确认后，再次运行 `npm run sync`，处理快照变化并重新通过 `node scripts/check-snapshot.mjs`。
- 使用与 dry-run 相同的 `--prerelease beta` 参数运行真实 release，检查 release diff、commit 与 tag，再执行 `git push --follow-tags origin beta`。
- 通过 npm registry 与 GitHub prerelease 回读发布结果，在隔离环境验证 `rd-guide.ref` 为 `main`。
- rd-guide MR-2 合入 `main` 后，完成目标 Skill 投影、逐字节一致性和未携带其它 `incubating` 资产的验证。

## Review Gates

- [x] 任务 Brief 未确认前不得启动或实施。
- [x] Check-All 未通过前不得提交业务改动。
- [x] `trellis-push` 的业务提交、推送和任务记录同步全部成功后，当前 task 才能标记完成。

后续发布门禁：`npm run sync` 与 `check-snapshot` 未通过前不得运行真实 release；dry-run 未展示并获 owner 明确确认前，不得修改版本文件、创建 release commit 或 tag；rd-guide MR-2 未合入前不得报告端到端安装回读完成。

## Rollback

- 业务提交前：恢复两个任务文件到任务基线并重新运行定向测试。
- 业务提交后、发版前：通过普通 revert 提交撤销，不改写已推送历史。
- 发版后：保留已发布版本与 tag，通过后续 beta 修正版回滚行为，不执行 npm unpublish、tag 覆盖或 force push。
