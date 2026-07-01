# Brief — 沉淀 humanize-writing skill

## Goal

- 把个人环境里的 `test` skill 沉淀为可维护、可安装、可验证的 `humanize-writing` skill，并为 flower-trellis 增加可发现、可单独安装增强 skill 的 CLI 入口。

## Scope

- 新增 `humanize-writing` 作为 skill-garden 0.6 的可选增强 skill，用户通过 `ft skill install humanize-writing` 显式安装。
- 新增 `ft skill list` 展示当前变体可安装增强 skill，并标识目标项目中已安装的条目。
- 新增 `ft skill install <name...>` 作为短路径，通过位置参数单独安装指定增强 skill，不运行完整 Trellis update。
- 将 `humanize-writing` 定义为中文文本润色、去 AI 腔和自然化改写技能，更新正式 frontmatter。
- 把 `/root/.codex/skills/test/SKILL.md` 的完整规则体系翻译并中文化，保留 33 类 AI 写作痕迹、误判排除、真人写作信号、处理流程和完整示例，而不是交付简短版中文润色指南。
- 增加返回前自检和反模式，让技能具备通用可执行约束：保留原意、不新增事实、语气匹配、输出干净、避免过度营销化或口语化。
- 同步维护 `.agents` 与 `.claude` 两份 skill 源文件。
- 运行 `npm run sync` 生成 `enhancements/0.6` 发布快照。
- 同步当前项目 dogfood 副本到 `.agents/skills/humanize-writing/` 与 `.claude/skills/humanize-writing/`。

## Non-Goals

- 不把该技能改造成 Trellis task、route、check、release 等流程技能。
- 不让 `humanize-writing` 成为默认全装项。
- 不把技能主体保留为英文版。
- 不新增自动化测试框架。
- 不修改全局 npm 安装目录或 `node_modules`。

## Key Context

- 真实源目录是 `vendor/skill-garden/.trellis/0.6/`，不能只改 `enhancements/0.6/` 或当前项目 dogfood 副本。
- `enhancements/0.6/` 是 `npm run sync` 生成的发布快照。
- 发布前检查会阻断 dirty `vendor/skill-garden` 工作区，避免发布未提交源生成的快照；本轮新增的源 skill 需要先在 skill-garden 提交并更新 submodule pin。
- `src/lib/skill-filter.js` 已支持非 `trellis-` 名称按完整名称匹配，因此 `--skills humanize-writing` 可以命中新目录，不要求修改过滤逻辑。
- `ft skill install` 应复用 `applyEnhancements(target, { variant, skills })`，语义等价于 `update --enhance-only --skills ...` 的短路径。
- 正文应使用中文规则和中文 before/after 示例，重点处理中文文本中的 AI 腔、空话和机械结构，同时保留原英文版完整章节和 33 个规则条目的覆盖面，并包含自检/反模式约束。
- 本仓库当前无自动化测试框架，验证以快照同步、一致性检查和 `git diff --check` 为主。

## Acceptance

- `vendor/skill-garden/.trellis/0.6/.agents/skills/humanize-writing/SKILL.md` 存在，frontmatter 名称与描述准确。
- `vendor/skill-garden/.trellis/0.6/.claude/skills/humanize-writing/SKILL.md` 存在，内容与 `.agents` 副本一致。
- `humanize-writing/SKILL.md` 保留原 `test` skill 的完整章节体系和 33 类规则，并完成中文化/本地化。
- `humanize-writing/SKILL.md` 包含返回前自检和反模式章节。
- `npm run sync` 后，`enhancements/0.6/.agents/skills/humanize-writing/` 与 `enhancements/0.6/.claude/skills/humanize-writing/` 存在。
- 通过现有 `--skills` 精细安装过滤可单独选择 `humanize-writing`，不要求修改默认全装行为。
- `ft skill list` 能列出当前变体可安装增强 skill，并标识目标项目中已安装的条目。
- `ft skill install humanize-writing` 或最终确认的等价语法能只叠加安装 `humanize-writing`，不触发 Trellis update。
- CLI help 包含 `skill list` / `skill install` 的用法说明。
- 当前项目 dogfood 副本按需同步到 `.agents/skills/humanize-writing/` 与 `.claude/skills/humanize-writing/`，不再依赖个人环境中的 `test` skill。
- 验证命令至少覆盖 `git diff --check`、`npm run sync` 结果、关键副本一致性检查。
- `scripts/check-snapshot.mjs` 能识别 dirty `vendor/skill-garden` 工作区并给出中文修复提示。
- 最终说明明确该技能属于 skill-garden 通用增强能力，不属于 Trellis 核心内置流程。

## Next Step

- 实现完成后进入 `trellis-route(check)`，执行全面检查；检查通过后停下汇报结果。
