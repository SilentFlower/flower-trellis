# 优化 Flower Trellis Skill 管理 - Design

## Architecture

`flower-trellis skill` 保持为 `src/commands/skill.js` 的子命令编排层，但语义改为裸命令直接进入 common skill 管理菜单，不再围绕 `list/install` 子命令分发。

可复用逻辑下沉到 `src/lib/`：

- skill catalog：汇总用户可自由选择的 common skill。
- skill metadata：从 `SKILL.md` frontmatter 读取 `name` / `description`，读取失败时降级为空描述。
- skill install/removal：按 common 快照中的精确路径安装或删除已安装 common skill。

## Skill Categories

### 基础 Trellis Skill

基础 Trellis skill 不在菜单中展示，也不允许由 `flower-trellis skill` 管理。

### Skill-garden / Trellis 工作流强化项

`trellis-*` 工作流强化项不在菜单中展示，避免用户误停用流程核心能力。

### Common Skill

来源为随包 `enhancements/common/.common` 快照。当前 common 快照来自 skill-garden `.common`，例如 `craft-slides`、`open-idea`、`humanize-writing`。

common skill 可自由选择。若目标项目中 `.codex/skills`、`.claude/skills` 或历史 `.agents/skills` / `.claude/skills` 存在同名 skill，则状态为已安装；否则为未安装。

## Data Flow

1. `flower-trellis skill` 校验目标项目存在 `.trellis/` 并解析增强包变体。
2. 读取 common skill 元数据和安装状态。
3. common skill 按未安装优先、已安装靠后排序。
4. 在 TTY 中用 `@inquirer/prompts` 的 `checkbox` 展示统一菜单：
   - 未安装项默认不勾选。
   - 已安装项默认勾选。
   - 主行显示名称与灰色短用途摘要，状态通过勾选态表达。
   - skill-garden/Trellis 工作流强化项放在只读分组中，显示用途摘要但禁用勾选。
5. 用户确认后：
   - 最终勾选且原未安装：从 `enhancements/common/.common` 精确复制到目标平台 skill 目录。
   - 最终未勾选且原已安装：按 common 清单声明的目标路径精确删除。
6. 打印安装、停用和跳过摘要。

## Safety

- 停用只处理 common 清单中存在的 skill 名称。
- 删除目标只限 `.codex/skills/<name>`、`.claude/skills/<name>` 与历史 `.agents/skills/<name>`，且 `<name>` 必须来自 common 清单。
- 不删除基础 Trellis skill、Trellis 工作流强化项，不根据 `trellis-*` 前缀泛删，不删除用户自建 skill。
- 非 TTY 直接抛中文错误，避免 prompt 在脚本环境中卡住。

## Compatibility

用户已要求不保留 `skill list` / `skill install` 子命令语义。因此本任务不要求向后兼容旧子命令。CLI help 与 README 需要同步移除旧用法，避免用户继续按旧模型理解功能。
