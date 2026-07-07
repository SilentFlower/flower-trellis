# Release Operations

## Conclusion
Release operations exist.

## Evidence Checked
- `task.json`: 活跃任务为 `fix-auto-update-codex-prompt`,发布快照策略为 `push`。
- `prd.md`: 需求包含自动更新远端探测顺序、Codex/Claude hook matcher、timeout、主动更新缓存刷新和发布验证。
- `design.md` / `implement.md` / `implement.jsonl` / `check.jsonl`: 实现范围覆盖 `self-check`、`update-check`、Codex/Claude hook 合并、hook 输出和规范同步。
- `release.md`: 原任务目录中缺失。
- git commits / changed files: `d208917`、`95eb10e`、`f05f7bf` 修改更新检查和 hook 行为;`26b0010` 发布 `0.4.5-beta.3`;`1dfc20a` 发布 `0.4.5`。

## Drift Check
Missing release.md. 已按当前任务文件、验证记录和发布提交补齐发布操作说明。

## SQL Changes
None

## Configuration Changes
- Codex 的 flower 更新检查 hook 归位到 `SessionStart` 的 `matcher: "startup"`,timeout 为 30 秒。
- Codex 的 Trellis 主上下文 hook 明确使用 `matcher: "startup|resume|clear|compact"`,timeout 为 30 秒。
- Claude 的 flower 更新检查 hook 保持 startup 语义,并同步增强 timeout / prompt 行为。
- 项目 manifest 的 `updateCheck` 语义变化:成功远端探测会刷新 `lastRemote` / `lastCheckedAt` / `lastStatus`,失败探测不得刷新 `lastCheckedAt`,失败状态不能作为新鲜远端证据。

## Batch / Deployment Scripts / Data Repair
- 已发布 npm beta 版本 `flower-trellis@0.4.5-beta.3`。
- 已发布 npm 正式版本 `flower-trellis@0.4.5`。
- `package.json`、`package-lock.json`、`CHANGELOG.md` 和 `enhancements/MANIFEST.json` 已随发布提交更新。
- 发布由 GitHub Actions OIDC 流程完成,没有一次性数据修复脚本。

## External Systems / Dependent Platforms
- npm dist-tags 已更新: `latest` 指向 `0.4.5`,`beta` 指向 `0.4.5-beta.3`。
- GitHub Actions 已执行 `v0.4.5` 发布流程。

## Release Order
1. 从 `main` 拉出 `beta-auto-update-codex-prompt` 实现并验证自动更新修复。
2. 发布并测试 beta 版本,最终 beta 为 `0.4.5-beta.3`。
3. 合回 `main` 后合并 CHANGELOG 的 beta 改动描述。
4. 发布正式版本 `0.4.5`。

## Rollback Notes
- 如正式版需要回退,可将 npm `latest` dist-tag 调回 `0.4.4`,或发布后续修复版本覆盖。
- 代码层面可回滚自动更新相关提交,重点文件包括 `src/lib/self-check.js`、`src/lib/update-check.js`、`src/assets/flower_update_hook.py`、`src/lib/codex-tweaks.js`、`src/lib/claude-tweaks.js` 和对应规范文件。
- 已安装到项目内的 `.codex/hooks.json`、`.claude/settings.json`、`.trellis/.flower-manifest.json` 可能需要通过旧版 `flower-trellis update` 或手工恢复确认。

## Post-release Verification
- `npm view flower-trellis dist-tags --json` 应显示 `latest=0.4.5`、`beta=0.4.5-beta.3`。
- 启动 Codex 新会话时,flower 更新检查只应在 `startup` 触发;resume / clear / compact 不应重复触发更新检查。
- `policy=ask` 时,hook 输出应包含必须先询问用户、确认前禁止执行推荐命令的 `systemMessage` 和 `<flower-update>` 阻塞确认标记。
- 主动运行 `flower-trellis update` / `ftl update` 成功联网后,已有 manifest 的 `updateCheck.lastRemote` 应刷新。
- 远端探测失败时,manifest 不应刷新 `lastCheckedAt`,下一次启动应继续尝试联网确认远端版本。
