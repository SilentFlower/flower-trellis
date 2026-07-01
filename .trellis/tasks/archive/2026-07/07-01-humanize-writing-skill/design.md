# 沉淀 humanize-writing skill 设计

## Architecture and Boundaries

本任务新增一个 skill-garden 通用增强 skill，并补充 `ft skill` 子命令作为增强 skill 的发现与安装入口。不修改 Trellis 核心工作流、route/check/release 技能或 `.trellis/spec/`。

源文件边界：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/humanize-writing/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/humanize-writing/SKILL.md`

派生快照边界：

- `enhancements/0.6/.agents/skills/humanize-writing/SKILL.md`
- `enhancements/0.6/.claude/skills/humanize-writing/SKILL.md`

当前项目 dogfood 副本边界：

- `.agents/skills/humanize-writing/SKILL.md`
- `.claude/skills/humanize-writing/SKILL.md`

CLI 边界：

- `src/cli.js` 解析并分发 `skill` 子命令。
- 新增 `src/commands/skill.js` 承载 `skill list` 与 `skill install` 编排。
- 新增或复用 `src/lib/` 中的增强 skill 枚举逻辑，避免在命令层堆路径扫描。

## Skill Content

`humanize-writing` 重新定义为中文文本润色技能。frontmatter 必须改为正式名称和中文触发描述。正文使用中文写作规则和中文 before/after 示例，重点处理中文文本里的 AI 腔、空泛表达、套路化结构、过度礼貌、机械小标题、意义膨胀和口吻不贴合。

正文不采用简短摘要，而是把 `/root/.codex/skills/test/SKILL.md` 的完整规则体系翻译并本地化：保留语气校准、人格与文字质感、内容模式、语言语法模式、风格模式、沟通模式、填充与含混、误判排除、真人写作信号、处理流程、完整示例和参考来源。33 个规则条目保持一一对应，但监测词和示例优先换成中文写作里真实常见的问题。

在原规则体系外补充两个通用 skill 约束章节：

- 返回前自检：要求检查原意、信息量、事实边界、语气匹配、AI 痕迹和输出干净程度。
- 反模式：明确不要编造、不要过度口语化、不要营销化、不要默认多版、不要破坏引用/代码/专有名词。

该 skill 不需要脚本、assets 或 references。虽然正文较长，但用户明确要求保留原英文版完整规则体系；为避免跨文件加载导致使用时漏读，先放在单个 `SKILL.md`。

## Installation Behavior

本任务不需要改 `src/lib/skill-filter.js`。现有过滤逻辑对非 `trellis-` 名称按完整名称匹配，因此 `--skills humanize-writing` 可以命中新目录。

`copy-skills.js` 会根据目标项目已有 `.agents/` 或 `.claude/` 目录复制对应 skill 副本。`npm run sync` 会从 `vendor/skill-garden/.trellis/0.6/` 生成 `enhancements/0.6/` 发布快照。

`ft skill install <name...>` 采用位置参数指定 skill 名称，支持一次传入多个名称。该命令应复用 `applyEnhancements(target, { variant, skills })`，并显式跳过 Trellis update，语义等价于 `ft update --enhance-only --skills <name...>` 的短路径。该命令应要求目标项目已有 `.trellis/`，否则沿用 `applyEnhancements` 的错误。

`ft skill list` 应读取当前目标项目的变体快照，枚举 `.agents/skills` 与 `.claude/skills` 的并集。若目标项目已存在对应 `.agents/skills/<name>` 或 `.claude/skills/<name>`，输出时标识为已安装；否则标识为可安装。

## Compatibility and Trade-offs

- 选择可选安装可以降低默认技能噪声，但用户需要显式传入 `--skills humanize-writing`。
- 增加 `ft skill list` / `ft skill install` 可以降低记忆成本，但需要在 `cli.js` 中为二级子命令增加解析分支。
- 聚焦中文规则会弱化旧英文文本处理覆盖，但符合用户确认的真实使用场景；原规则体系保留为中文化版本，而不是删除。
- 同步 `.agents` 与 `.claude` 两份源文件会产生重复，但符合当前增强包发布结构。

## Rollback

如需回滚，删除新增的 `humanize-writing` 源目录、重新运行 `npm run sync`，并删除当前 dogfood 副本。不要手动只删 `enhancements/0.6`，否则下一次 sync 会再次生成。
