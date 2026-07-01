# 沉淀 humanize-writing skill

## Goal

把当前个人环境里的 `test` skill 沉淀为可维护、可安装、可验证的 `humanize-writing` skill，并为 flower-trellis 增加可发现、可单独安装 skill-garden 增强 skill 的 CLI 入口。

该任务的价值是把临时占位技能变成后续用户可通过 flower-trellis 安装的正式技能，同时让用户能直接查看有哪些增强 skill 可装，并用专门命令安装，而不是记忆 `update --enhance-only --skills ...` 组合。

## Background

- 当前 `/root/.codex/skills/test/SKILL.md` 是临时占位技能；用户确认真实目标是把该技能沉淀为面向中文文本润色、去 AI 腔和自然化改写的正式 `humanize-writing` skill。
- flower-trellis 的增强包源头是 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/` 是由 `npm run sync` 生成的发布快照，不能只改快照。
- 0.6 增强包同时维护 `.agents/skills` 与 `.claude/skills` 两套 skill 副本，安装时由 `src/lib/copy-skills.js` 根据目标项目已有平台目录铺设。
- `src/lib/skill-filter.js` 支持 `--skills <name>` 精细安装；非 `trellis-` 名称会按完整名称匹配。
- 当前 CLI 只有 `--skills <name>` 过滤安装，没有专门列出可安装增强 skill 或单独安装增强 skill 的命令。
- 仓库当前没有自动化测试框架；叠加逻辑验证以 `node --check`、`npm run sync`、快照一致性和 dogfood 手测为主。
- 检查阶段发现发布风险：`npm run sync` 会读取 `vendor/skill-garden` 工作区内容；若 submodule 有未提交源文件，快照可能包含不可追溯内容。

## Requirements

- 新技能名称使用 `humanize-writing`，不得继续使用 `test`。
- 技能应面向中文文本润色，覆盖去 AI 腔、保留原意、匹配作者语气、压缩空话、提升自然度等场景。
- 技能正文应保留 `/root/.codex/skills/test/SKILL.md` 的完整规则体系，包括语气校准、人格与文字质感、33 类 AI 写作痕迹、误判排除、真人写作信号、处理流程、完整示例和参考来源。
- 技能正文应补充可复用 skill 所需的执行自检与反模式，约束保留原意、不编造、不丢信息、不过度口语化、不默认多版输出等通用行为。
- 技能正文应翻译并中文化，而不是只写一份简短摘要；示例、监测词、改写策略要适配中文写作语境。
- 技能作为可选增强项交付，用户通过 `ft skill install humanize-writing` 显式安装；本任务不把它提升为默认全装项。
- 技能应提供准确 frontmatter，确保 Codex 在用户要求中文润色、去 AI 味、改得像人写的、自然化改写、优化中文表达等场景触发。
- 技能内容应从个人环境迁移到 skill-garden 0.6 源目录，并同步到 `.agents/skills` 与 `.claude/skills`。
- 生成发布快照时必须通过 `npm run sync`，确保 `enhancements/0.6` 与源目录一致。
- 发布前检查必须阻断 dirty `vendor/skill-garden` 工作区，避免发布未提交源生成的快照。
- 新增 `ft skill list` 命令，展示当前目标项目匹配变体下可安装的增强 skill，至少包含 skill 名称，并能看出目标项目是否已安装。
- 新增 `ft skill install <name...>` 命令，作为 `update --enhance-only --skills ...` 的用户友好入口，只安装指定增强 skill，不运行完整 Trellis update。
- `skill list` / `skill install` 必须继续支持 `--target <dir>` 与 `--variant <old|0.5|0.6>`，沿用现有变体选择和目标项目校验逻辑。
- 实现应避免修改 Trellis 核心工作流、`.trellis/spec/` 或 `trellis-*` 流程技能，除非后续发现安装链路需要最小代码调整。
- 技能正文应中文化，使用中文写作规则和中文示例；英文术语可按需括注，但英文文本处理不作为主要目标。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.trellis/0.6/.agents/skills/humanize-writing/SKILL.md` 存在，frontmatter 名称与描述准确。
- [ ] `vendor/skill-garden/.trellis/0.6/.claude/skills/humanize-writing/SKILL.md` 存在，内容与 `.agents` 副本一致。
- [ ] `humanize-writing/SKILL.md` 保留原 `test` skill 的完整章节体系和 33 类规则，并完成中文化/本地化，不再是简短版中文润色指南。
- [ ] `humanize-writing/SKILL.md` 包含返回前自检和反模式章节，覆盖保留原意、不新增事实、语气匹配、输出干净、避免过度营销化/口语化等要求。
- [ ] `npm run sync` 后，`enhancements/0.6/.agents/skills/humanize-writing/` 与 `enhancements/0.6/.claude/skills/humanize-writing/` 存在。
- [ ] 通过现有 `--skills` 精细安装过滤可单独选择 `humanize-writing`，不要求修改默认全装行为。
- [ ] `ft skill list` 能列出当前变体可安装增强 skill，并标识目标项目中已安装的条目。
- [ ] `ft skill install humanize-writing` 或最终确认的等价语法能只叠加安装 `humanize-writing`，不触发 Trellis update。
- [ ] CLI help 包含 `skill list` / `skill install` 的用法说明。
- [ ] 当前项目 dogfood 副本按需同步到 `.agents/skills/humanize-writing/` 与 `.claude/skills/humanize-writing/`，不再依赖个人环境中的 `test` skill。
- [ ] 验证命令至少覆盖 `git diff --check`、`npm run sync` 结果、关键副本一致性检查。
- [ ] `scripts/check-snapshot.mjs` 能识别 dirty `vendor/skill-garden` 工作区并给出中文修复提示。
- [ ] 最终说明明确该技能属于 skill-garden 通用增强能力，不属于 Trellis 核心内置流程。

## Out of Scope

- 不把该技能改造成 Trellis task、route、check、release 等流程技能。
- 不把技能主体保留为英文版；最终可交付内容必须是中文化规则体系。
- 不让 `humanize-writing` 成为默认全装项。
- 不新增自动化测试框架。
- 不修改全局 npm 安装目录或 `node_modules`。
