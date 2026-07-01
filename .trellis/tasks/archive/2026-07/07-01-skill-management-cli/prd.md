# 优化 Flower Trellis Skill 管理

## Goal

让 `flower-trellis skill` 成为一个可理解、可交互的 common skill 管理入口：用户可以看到可自选 common skill 的用途简介，并直接在菜单里选择安装或卸载。

该功能解决当前 `skill list/install` 只列名称、不解释用途、不能交互选择、不能精细停用的问题。用户已明确要求后续主入口就是 `flower-trellis skill`，不需要保留 `skill list` / `skill install` 这类子命令。

## Confirmed Facts

- 现有 CLI 已有 `flower-trellis skill list` 与 `flower-trellis skill install <name...>`，入口在 `src/commands/skill.js`。
- 当前 Trellis 工作流强化 skill 清单来自 `enhancements/<variant>/.agents/skills` 与 `enhancements/<variant>/.claude/skills`，由 `src/lib/enhancement-catalog.js` 汇总。
- common skill 需要从 skill-garden `.common` 同步到随包快照，并由 `flower-trellis skill` 独立管理。
- common skill 安装应跟随目标项目已有平台目录：`.codex/` 项目铺到 `.codex/skills`，`.claude/` 项目铺到 `.claude/skills`；两者都不存在时兜底铺 Claude。
- `humanize-writing` 语义上是用户可自由选择的 common skill，已迁移到 skill-garden `.common`；旧项目里装在 `.agents/skills` 的副本仍需被识别和精确卸载。
- 当前列表只显示 skill 名称和“已安装/可安装”，没有读取 `SKILL.md` frontmatter 的 `description`。
- 当前没有针对单个 skill 的 disable/uninstall 子命令；全局 `uninstall` 只在卸载 Trellis 后补清强化残留。
- 用户决策：`flower-trellis skill` 裸命令直接进入交互式管理；`install`、`list` 这类子命令可以移除，不作为兼容要求。
- Trellis npm 包内存在基础 common skill 模板：
  - `node_modules/@mindfoldhq/trellis/dist/templates/common/skills/*.md`，如 `before-dev`、`brainstorm`、`break-loop`、`check`、`update-spec`。
  - `node_modules/@mindfoldhq/trellis/dist/templates/common/bundled-skills/*/SKILL.md`，如 `trellis-channel`、`trellis-meta`、`trellis-session-insight`、`trellis-spec-bootstrap`。
- 用户反馈确认：菜单不应显示基础 Trellis skill；skill-garden/Trellis 工作流强化项可以只读展示，但不应作为用户可勾选项出现。菜单只允许管理用户可自由选择的 common skill。
- 用户反馈确认：已安装项默认勾选；未安装项排在前面；菜单主行保持短文案，简介以灰色短摘要展示，避免长状态文案破坏排版。
- 项目规范要求交互 prompt 使用 `@inquirer/prompts`，非 TTY 必须不阻塞。

## Requirements

- `flower-trellis skill` 必须在交互终端中打开 common skill 管理菜单，菜单展示用途简介；简介优先来自 `SKILL.md` frontmatter 的 `description`。
- 菜单可勾选项只包含用户可自由安装/卸载的 common skill，不显示基础 Trellis skill。
- skill-garden/Trellis 工作流强化项应只读展示用途简介，不允许勾选，避免用户误停用流程核心能力。
- 未安装 common skill 排在已安装项前面；已安装项默认勾选。
- 菜单主行必须短且清晰；用途简介应以轻量灰色摘要展示，不和状态长文案挤在同一行。
- 保存时按最终勾选状态同步：未勾选的已安装 common skill 会被卸载，勾选的未安装 common skill 会被安装。
- 停用 common skill 时，只能删除 common skill 清单中精确匹配的 skill 路径，不得删除 Trellis 基础 skill、Trellis 工作流强化项或用户自建 skill。
- 非交互场景不能卡在 prompt；`flower-trellis skill` 在非 TTY 下给出清晰错误提示，不等待输入。
- `skill list` / `skill install` 不需要继续作为公开入口；CLI 帮助、README 与错误提示应删除或替换旧说明。
- CLI 帮助与 README 中的 `skill` 说明需要同步更新。

## Acceptance Criteria

- [ ] `flower-trellis skill` 在 TTY 中打开 common skill 管理菜单，主列表排版清晰，不显示基础 Trellis skill。
- [ ] 菜单只读显示 skill-garden/Trellis 工作流强化项，不允许勾选。
- [ ] 未安装 common skill 排在已安装项前面；已安装 common skill 默认勾选。
- [ ] 保存后按最终勾选状态安装/卸载 common skill。
- [ ] 停用 common skill 只删除 common 清单中声明的目标路径，不删除 Trellis 基础 skill、Trellis 工作流强化项或用户自建 skill。
- [ ] 非 TTY 调用 `flower-trellis skill` 不阻塞，并输出中文错误提示。
- [ ] `skill list` / `skill install` 不再出现在 `--help` 与 README 的推荐用法中。
- [ ] README 与 `--help` 输出包含新的 `flower-trellis skill` 交互管理用法。
- [ ] 变更通过静态检查与至少一个临时 Trellis 项目的 CLI 行为验证。
