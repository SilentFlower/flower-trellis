# Design

## Boundaries

- Flower 手动升级入口属于 Skill-Garden 0.6 强化包能力，authoring source 放在 `vendor/skill-garden/.trellis/0.6/.agents/skills/` 与 `.claude/skills/`，再通过 `npm run sync` 刷新 `enhancements/0.6/`。
- `aliyun-sls-query` 是 common skill，authoring source 放在 `vendor/skill-garden/.common/.codex/skills/aliyun-sls-query/` 与 `.common/.claude/skills/aliyun-sls-query/`，再同步到 `enhancements/common/`。
- `trellis-worktree` 菜单说明属于 Flower skill catalog 展示层，修复点是 `src/lib/skill-catalog.js` 的中文 override。
- CLI 行为修复集中在 `src/commands/self-check.js`、`src/commands/self-update.js`、`src/lib/self-check.js`，保持 hook 自动路径默认不传人工入口参数。

## Contracts

- `buildSelfCheck(..., { ignorePromptSuppression: true })` 已存在底层能力；CLI 只需要暴露稳定参数并在线路中使用。
- `self-check --manual` 或等价参数只影响提示抑制，不跳过远程探测、项目本地一致性读取、policy、安全检查或 release notes 生成。
- `self-update` 是用户显式写入命令；其预检应忽略 prompt suppression，但仍要求 `--yes` 才能写入。
- 新 skill 只指导 AI 使用既有 CLI 命令，不直接读写 `.flower/update-check.tmp`，不建议通过 `update-check reset` 绕过抑制。
- 新 skill 必须在 frontmatter 和正文中明确排除发版、release、tag、npm publish、package 版本号修改等语义，避免“更新 Flower 强化包”和“发布项目版本”混淆。
- 新 skill 的触发说明和菜单说明分开保证：frontmatter 负责自动触发，`SKILL_DESCRIPTION_OVERRIDES` 或等价展示机制负责中文短说明。
- SLS skill 新增内容是排障守则，不改变脚本参数、签名器或凭证纪律。

## Compatibility

- 自动 SessionStart hook 继续调用 `flower-trellis self-check --json --target <dir>`，因此旧的 snooze/skip/cooldown 行为保持不变。
- 人工入口是新增兼容参数；未使用参数的现有自动化不受影响。
- `trellis-worktree` frontmatter 保持英文触发描述，避免影响 Skill 自动触发；仅菜单显示中文短句。
- `trellis-flower-update` 新增时同步考虑菜单展示，不能只依赖 frontmatter 自动摘要。

## Risks

- 如果只新增 skill 而不改 CLI 参数，skill 需要解析 `suppressedAction` 或 reset 缓存，语义不干净。
- 如果 `self-update` 不使用人工入口，用户直接运行写入命令仍可能被旧提示抑制影响。
- 如果只改 `enhancements/` 快照而不改 `vendor/skill-garden` authoring source，下次同步会丢失变更。
