# Brief — 优化自动更新变更说明与推送联动

## Goal

- 让 flower-trellis 的自动更新提醒展示跨版本更新内容,并在用户确认执行自动升级后,把升级产生的文件变动引导到 `trellis-push` 确认流程。

## Scope

- 在 npm package metadata 中加入 flower 内部字段 `flowerReleaseNotes`,由 release 流程从 `CHANGELOG.md` 当前版本段生成。
- 扩展 npm registry 读取逻辑,一次请求同时解析 dist-tags 与各版本 notes metadata。
- 在 `self-check --json` 中为 `update_available` 与 `project_out_of_sync` 生成受限 release notes 摘要。
- 在 manifest `updateCheck` 中新增独立 notes 缓存,保持 `lastRemote` 只记录版本事实。
- 在 `flower_update_hook.py` 注入 release notes 摘要、范围和截断标记,帮助 AI 在确认前说明更新内容。
- 在 `self-update --yes` 完成后输出 `<flower-update-result>`,提示 AI 汇总升级变动并进入 `trellis-push` 确认计划。
- 在 `self-update --dry-run` 输出 release notes 和后续动作预览,但不输出真实 push post_action。
- 更新 skill-garden 0.6 workflow hub 的轻量兜底提醒,并同步 `enhancements/0.6` 与当前 dogfood 副本。
- 同步更新 CLI 配置状态、发布流程、增强包模型和质量规范。

## Non-Goals

- 不在启动 hook 中自动执行 `self-update` 或 `trellis-push`。
- 不在 `self-update` 内执行 `git add`、`git commit` 或 `git push`。
- 不把完整 CHANGELOG 原文无限制注入到 SessionStart。
- 不把 `flowerReleaseNotes` 在 README 中承诺为第三方公共 API。
- 不引入重依赖解析 changelog,除非实现中证明轻量方案不足。

## Key Context

- 关键代码入口:`src/lib/update-check.js`、`src/lib/self-check.js`、`src/lib/manifest.js`、`src/assets/flower_update_hook.py`、`src/commands/self-update.js`。
- 发布脚本入口:`scripts/extract-changelog.mjs`、新增 `scripts/write-release-notes-metadata.mjs`、`package.json` 的 `commit-and-tag-version.scripts.postchangelog`。
- workflow override 源必须先改 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`,再 `npm run sync` 到 `enhancements/0.6`;不要只改当前项目副本。
- release notes 聚合按目标通道过滤:stable 目标不混入 beta notes;beta 目标只展示 beta notes;beta 回 stable latest 以 stable notes 为主。
- 摘要上限:最多 5 个版本、总注入最多 1600 字符、单版本最多 500 字符,超限必须显式标记。
- registry / notes 失败必须降级,不得影响版本判断、启动 hook 或远端缓存失败语义。

## Acceptance

- `updateCheck.lastRemote` 仍只记录 dist-tags;新增 notes 缓存向后兼容旧 manifest。
- npm 每个版本 metadata 只保存该版本自己的 release notes;跨版本摘要由 `self-check` 从 registry `versions` 聚合生成。
- `<flower-update>` 在 `policy=ask` 时能同时展示推荐命令和变更摘要,并继续要求用户确认。
- `project_out_of_sync` 且推荐 `--project-only` 时也展示项目将追平到当前 flower 版本的变更摘要。
- `self-update --yes` 完成后输出 `post_action=run_trellis_push_confirmation`;`--dry-run` 只输出 `post_action_preview`。
- workflow override 只新增轻量兜底提醒。
- 语法校验、hook JSON 校验、manifest 兼容性检查、release metadata 生成路径和 `git diff --check` 通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后,运行 `task.py start update-notes-push-flow`;随后进入 Phase 2.1 的 `trellis-route(implement)`。
