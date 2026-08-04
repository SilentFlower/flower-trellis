# Implement Plan

1. 更新 CLI 人工入口：
   - 在 `self-check` 命令解析 `--manual` / `--ignore-prompt-suppression`。
   - 把该参数传给 `buildSelfCheck(..., { ignorePromptSuppression: true })`。
   - 让 `self-update` 调用 `buildSelfCheck` 时启用人工入口语义。

2. 新增 Flower 手动升级 skill：
   - 在 Skill-Garden 0.6 Codex / Claude authoring source 新增 `trellis-flower-update/SKILL.md`。
   - skill 说明必须强调：用户确认前不执行写入；使用人工 self-check；使用推荐 `self-update`；不要 reset/snooze/skip 作为绕过手段。
   - skill 触发说明必须明确排除“我想发版了”、release、tag、npm publish 和 package 版本号发布流程。
   - 为 `trellis-flower-update` 配置中文菜单短说明，避免新增后显示占位文案。
   - 同步刷新 `enhancements/0.6/`。

3. 更新 SLS common skill：
   - 在 Codex / Claude 两份 `aliyun-sls-query/SKILL.md` 加入 Java Forest/HTTP trace 配对守则。
   - 同步刷新 `enhancements/common/`。

4. 修复 `trellis-worktree` 菜单说明：
   - 在 `SKILL_DESCRIPTION_OVERRIDES` 添加 `trellis-worktree` 和 `trellis-flower-update` 中文短描述。
   - 补充或更新 skill catalog 测试，断言两个 skill 说明都不是“查看技能说明”。

5. 验证：
   - 运行相关 Node 测试：`node --test test/js/update-check.test.js test/js/common-skill-catalog.test.js`，并按实际新增测试文件调整。
   - 运行 `npm run sync` 后检查快照 diff。
   - 运行 `node scripts/check-snapshot.mjs` 或至少相关快照/skill catalog 检查。
   - 运行 `git diff --check`。
