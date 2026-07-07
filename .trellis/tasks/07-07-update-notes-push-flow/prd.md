# 优化自动更新变更说明与推送联动

## Goal

让 flower-trellis 的自动更新提醒更可解释、更不容易被 AI 绕过,并在用户确认执行自动升级后,把升级产生的文件变动自然纳入 Trellis push 确认流程。

用户价值:

- 启动更新提醒不仅告诉用户“有更新”,还要说明将跨哪些版本、主要更新内容是什么。
- Codex / Claude Code 等平台即使对 hook 注入执行强度不同,也应优先处理 flower 更新确认。
- 自动升级修改项目文件后,AI 能把这些升级改动作为本轮默认候选变动,进入 `trellis-push` 的确认和提交/推送流程。

## Background

当前 `updateCheck.lastRemote` 只记录 npm dist-tags 版本事实,例如 `latest` / `beta`。启动 hook 因此只能告诉用户“有更新”或“项目铺设版本不一致”,不能说明跨版本升级会带来哪些变化。用户希望 AI 在询问确认前展示精简更新内容,并在确认执行自动升级后,把升级产生的项目文件变动带入 `trellis-push` 的提交/推送确认流程。

## Product Decisions

- `lastRemote` 继续只记录远端版本事实;release notes 使用独立缓存字段。
- MVP 使用 npm metadata 承载 release notes,不依赖 GitHub Releases 作为主路径。
- npm metadata 字段先作为 flower 内部字段,建议命名为 `flowerReleaseNotes`;暂不作为 README 公共 API 承诺。
- 每个 npm 版本 metadata 只保存当前版本 notes;跨版本升级时,`self-check` 从同一次 npm registry 根文档响应里的 `versions` 字典聚合多个版本 notes。
- 不保存 recent notes map,避免每个版本重复放大 registry 响应。
- 跨版本摘要上限为最多 5 个版本、总注入最多 1600 字符、单个版本 notes 最多 500 字符。
- 跨版本聚合按目标通道过滤:stable 目标只展示 stable notes;beta 目标只展示 beta notes;beta 回 stable latest 时以 stable 目标 notes 为主。
- `project_out_of_sync` 也展示更新内容:远端没有新版但项目 manifest 的 `flowerVersion` 低于当前本地 flower 时,聚合 `project_flower < version <= current_flower` 的 notes。
- `self-update --dry-run` 展示 release notes 和后续动作预览,但不输出真实 push post_action。
- `self-update --yes` 完成写入型更新后输出 `<flower-update-result>`,提示 AI 汇总升级改动并进入 `trellis-push` 确认计划。
- workflow override 只增加轻量兜底提醒,降低 AI 绕过 `<flower-update>` 的概率,不复制大量 hook 字段说明。

## Confirmed Facts

- `normalizeUpdateCheck()` 当前只保留 `lastRemote.latest` / `lastRemote.beta`、`lastCheckedAt`、`lastStatus`、`lastErrorCode`;旧 manifest 通过默认值兼容。见 `src/lib/manifest.js`。
- `fetchPackageDistTags()` 目前只请求 npm registry 根文档并读取 `dist-tags.latest` / `dist-tags.beta`;`checkForUpdate()` 成功后只把 dist-tags 写入 manifest,不读取 release notes。见 `src/lib/update-check.js`。
- `buildSelfCheck()` 返回的 `remote.tags` 与 `recommendation` 只包含版本和推荐命令,没有更新内容字段。见 `src/lib/self-check.js`。
- `flower_update_hook.py` 只把版本、远端 tags、推荐命令、安全原因和 AI 指令写入 `<flower-update>`;没有 release notes 输出。见 `src/assets/flower_update_hook.py`。
- `self-update` 当前执行完项目重叠加后只打印完成信息,没有结构化提示 AI 进入 `trellis-push`。见 `src/commands/self-update.js`。
- `trellis-push` 已定义“先计划、一次确认、后执行”的提交/推送边界,要求确认具体文件列表与 commit message,适合承接自动升级后的文件变动。见 `.agents/skills/trellis-push/SKILL.md`。
- skill-garden 0.6 workflow override 的源在 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 与 `workflow-states/*.md`;修改后需要 `npm run sync` 同步到 `enhancements/0.6` 和当前 dogfood 副本。见 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。
- `package.json` 的 `files` 白名单当前不包含 `CHANGELOG.md`;`npm pack --dry-run --json` 也确认 npm tarball 内没有 `CHANGELOG.md`。
- `npm view flower-trellis@0.4.5 changelog releaseNotes --json` 当前没有输出;npm metadata 没有标准逐版本更新日志字段。
- GitHub Release `v0.4.5` 可通过 GitHub API 读取 `body`;发布 workflow 明确用 `scripts/extract-changelog.mjs` 从 `CHANGELOG.md` 抽取对应版本段作为 release notes。见 `.github/workflows/release.yml`。
- 由于运行 self-check 的是“当前已安装旧版本”,它本地包内即使包含 `CHANGELOG.md`,也通常看不到未来远端版本的 changelog;远端新版 notes 需要联网读取 GitHub Release / raw CHANGELOG / npm metadata 中的自定义字段。
- 用户已决定本任务优先使用 npm metadata 承载新版 release notes,GitHub Releases 不作为 MVP 主路径。
- npm registry 根文档 `https://registry.npmjs.org/flower-trellis` 一次响应中包含 `dist-tags`、`versions` 字典和每个版本的 package metadata;未来自定义 package.json 字段可随版本 metadata 被读取,不需要额外请求 GitHub。
- `commit-and-tag-version@12.7.3` 支持 `postchangelog` 生命周期;该 hook 在 CHANGELOG 生成后、release commit 前执行,可用于把 CHANGELOG 对应版本段写入 `package.json` 自定义 metadata。
- `commit-and-tag-version` 的 commit 步骤会提交 bump 阶段更新过的 `package.json` 等文件;`postchangelog` 对 `package.json` 的 notes metadata 修改可随 release commit 一起提交。
- 现有 CHANGELOG 最近 10 个版本段按每段 800 字节上限估算,原始 notes 约 2.6KB;即使按最坏 10 段各 800 字节也约 8KB 加 JSON 开销。但由于 npm registry 根文档已经包含所有版本 metadata,无需在每个版本中重复保存 recent map。

## Requirements

- R1: 远端版本事实与更新内容缓存必须分离;`lastRemote` 继续表达 npm dist-tags,新增字段用于缓存 release notes / changelog 摘要。
- R2: 更新内容来源优先使用 npm registry 可随版本发布的自定义 metadata;该 metadata 的内容应来自发布时的 CHANGELOG 版本段。
- R2.1: GitHub Releases 不作为 MVP 主路径;若保留后续扩展点,联网失败必须静默降级,不得影响 npm dist-tags 检查。
- R2.2: release notes metadata 生成应接入现有 release 流程,在 `postchangelog` 后从 `CHANGELOG.md` 抽取对应版本段并写入 `package.json` 自定义字段。
- R2.3: MVP 应倾向每个版本 metadata 只保存该版本自己的 notes;跨版本升级时从同一次 npm registry 响应的 `versions` 字典聚合多个版本 notes,避免 recent map 在每个版本重复放大 registry 响应。
- R2.4: 不在 npm metadata 中保存 recent notes map;跨版本聚合由客户端基于 registry `versions` 完成。
- R2.5: npm metadata 字段为内部字段,不在本任务中承诺公开稳定 schema;字段名建议为 `flowerReleaseNotes`。
- R3: 跨版本升级时,更新提醒应聚合当前版本到目标版本之间的相关条目,并限制最大版本数与最大字符数。
- R3.1: 默认上限为最多 5 个版本、总注入摘要最多 1600 字符、单个版本 notes 最多 500 字符。
- R3.2: 版本条目或文本被截断时,hook 注入内容必须显式标记 `truncated` / `more_versions` 或等价字段。
- R3.3: 跨版本聚合必须按目标通道过滤:stable 目标不展示中间 beta notes;beta 目标只展示 beta 通道 notes;beta 回 stable 时可标注通道切换,但摘要主体以 stable 目标版本 notes 为准。
- R4: `self-check --json` / hook 注入应提供精简更新内容,便于 AI 在询问确认时展示“将更新什么”。
- R4.1: `project_out_of_sync` 且远端无新版时也应生成 release notes 摘要;范围为项目记录的 flower 版本到当前本地 flower 版本,按目标通道和摘要上限过滤。
- R4.2: `project_out_of_sync` notes 获取失败时不得影响项目重叠加提示;应降级为只展示版本差异和推荐命令。
- R5: workflow override 中应加入轻量 flower 更新提醒兜底,避免高频提示过长,同时不改变 Trellis 路由等核心流程。
- R6: 用户确认执行自动升级后,升级产生的文件变动应默认进入 `trellis-push` 确认流程;不得静默提交或推送。
- R7: 自动升级和 push 联动必须保留用户审计边界:启动 hook 不直接写盘,执行升级前仍需用户确认,提交/推送前仍需用户确认。
- R8: `self-update` 完成写入型更新后必须输出结构化后续动作块,至少包含执行状态、目标目录、是否检测到 git 变动、建议后续动作和 AI 指令。
- R9: 结构化后续动作块只能提示 AI 进入 `trellis-push` 确认流程;不得让 `self-update` 自己执行 git add / commit / push。
- R10: `self-update --dry-run` 应输出 release notes 摘要和后续动作预览,但不得输出真实 push post_action;dry-run 输出必须明确 `write=false`。

## Acceptance Criteria

- [ ] `updateCheck.lastRemote` 仍只记录远端版本事实;新增更新内容缓存字段结构清晰、可向后兼容旧 manifest。
- [ ] npm 每个版本 metadata 只保存该版本自己的 release notes;跨版本摘要由 `self-check` 从 registry `versions` 聚合生成。
- [ ] release notes metadata 使用内部字段,并在 spec 中记录兼容策略;README 不把该字段声明为第三方公共 API。
- [ ] 跨版本升级时,注入内容包含受限长度的变更摘要,并能标明内容被截断或还有更多版本变更。
- [ ] 默认摘要上限为 5 个版本 / 1600 字符 / 单版本 500 字符,超限时有明确截断标记。
- [ ] stable 更新摘要不会混入 beta notes;beta 更新摘要只包含 beta 通道 notes;beta 回 stable latest 的提示不重复展示 beta 历史。
- [ ] 更新内容获取失败时,启动检查仍可正常返回版本更新提示,不阻断会话。
- [ ] `<flower-update>` 在 `policy=ask` 时能让 AI 同时展示推荐命令和变更摘要,并继续要求用户确认。
- [ ] `project_out_of_sync` 且推荐 `--project-only` 时,hook 也能展示项目将追平到当前 flower 版本的变更摘要。
- [ ] workflow override 只新增轻量兜底提醒,不复制大量 hook 规则。
- [ ] 自动升级执行后若产生 git 变动,AI 会把升级文件变动纳入默认 push 候选,并通过 `trellis-push` 或等价确认流程提交/推送。
- [ ] `self-update --yes` 完成后输出 `<flower-update-result>` 或等价结构化块,明确 `post_action=run_trellis_push_confirmation`。
- [ ] `self-update --dry-run` 输出 release notes 和 `post_action_preview`,但不会提示 AI 立即进入 `trellis-push`。
- [ ] 语法校验、hook JSON 校验、manifest 兼容性检查和 diff 检查通过。

## Out of Scope

- 不在启动 hook 中自动执行 `self-update` 或 `trellis-push`。
- 不在 `self-update` 内执行 `git add` / `git commit` / `git push`。
- 不把完整 CHANGELOG 原文无限制注入到 SessionStart。
- 不引入重依赖来解析 changelog,除非代码检查证明现有轻量方案不足。
