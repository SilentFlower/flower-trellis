# Brief — 优化 Flower Trellis Skill 管理

## Goal

- 将 `flower-trellis skill` 改为可理解、可交互的 common skill 管理入口，只展示用户可自由选择的 common skill，并允许用户在菜单中安装或卸载。

## Scope

- 重写 `flower-trellis skill` 裸命令语义：直接进入交互菜单，不再围绕 `list` / `install` 子命令分发。
- 可勾选项只展示 common skill，不展示基础 Trellis skill。
- 只读展示 skill-garden/Trellis 工作流强化项，避免用户误停用流程核心能力，同时让用户能看到随包能力。
- 从 `SKILL.md` frontmatter 的 `description` 读取用途简介；读取失败时降级为空简介或跳过非关键基础项。
- 未安装 common skill 排在前面；已安装 common skill 默认勾选。
- 菜单主行保持短文案；简介以灰色短摘要展示，避免长描述破坏列表排版。
- 对最终勾选且原未安装的 common skill 从 `enhancements/common/.common` 精确复制到目标平台 skill 目录。
- 对最终未勾选且原已安装的 common skill 按 common 清单精确路径删除。
- 更新 CLI help 与 README，移除旧 `skill list` / `skill install` 推荐用法。

## Non-Goals

- 不保留 `skill list` / `skill install` 作为公开兼容接口。
- 不显示、不允许 flower 停用或删除 Trellis 基础 skill。
- 不显示、不允许 flower 停用 skill-garden/Trellis 工作流强化项。
- 不根据 `trellis-*` 前缀泛删目标项目中的 skill。
- 不新增自动化测试框架。

## Key Context

- 现有入口：`src/commands/skill.js`。
- common skill catalog：`src/lib/skill-catalog.js` 读取 `enhancements/common/.common`，并识别历史 `.agents/skills/<name>` 安装状态。
- skill-garden/Trellis 工作流强化包：`src/lib/enhancement-catalog.js` 读取 `enhancements/<variant>/.agents/skills` 与 `enhancements/<variant>/.claude/skills`，菜单只读展示。
- `humanize-writing` 已归入 skill-garden `.common`，不再从 Trellis 0.6 工作流强化快照发布。
- 交互约束：必须使用 `@inquirer/prompts`；非 TTY 不能阻塞，应抛中文错误。
- 删除安全边界：只删除 common 清单中存在的 `.codex/skills/<name>`、`.claude/skills/<name>` 与历史 `.agents/skills/<name>`。
- 依赖路径定位：读取 `@mindfoldhq/trellis` 模板应使用 `createRequire(import.meta.url)`，不要硬编码当前仓库 `node_modules` 路径。

## Acceptance

- `flower-trellis skill` 在 TTY 中打开 common skill 管理菜单，主列表排版清晰，不显示基础 Trellis skill。
- 菜单只读显示 skill-garden/Trellis 工作流强化项，不允许勾选。
- 未安装 common skill 排在已安装项前面；已安装 common skill 默认勾选。
- 保存后按最终勾选状态安装/卸载 common skill。
- 停用 common skill 只删除 common 清单中声明的目标路径，不删除 Trellis 基础 skill、Trellis 工作流强化项或用户自建 skill。
- 非 TTY 调用 `flower-trellis skill` 不阻塞，并输出中文错误提示。
- `skill list` / `skill install` 不再出现在 `--help` 与 README 的推荐用法中。
- README 与 `--help` 输出包含新的 `flower-trellis skill` 交互管理用法。
- 变更通过静态检查与至少一个临时 Trellis 项目的 CLI 行为验证。

## Next Step

- 用户确认 planning artifacts 与本 brief 后，运行 `task.py start` 激活任务；进入实现阶段后先走 `trellis-route(implement)`。
