# 统一通用技能目录与空目录双平台安装

## Goal

统一通用技能的 Codex 安装目录，让空目录通过 `ftl plugin` 的 Skill Garden 入口安装技能后同时供 Codex 和 Claude 使用，并保证既有安装可继续更新、识别和卸载。

## Requirements

- R1：Codex 通用技能的新安装目标使用 `.agents/skills/<name>`；Claude 使用 `.claude/skills/<name>`。
- R2：无 `.codex`、`.agents`、`.claude` 平台目录时，默认同时安装上述两份。已有 `.codex` 或 `.agents` 时选择共享目标，已有 `.claude` 时选择 Claude 目标；已有单侧平台不额外启用另一侧。
- R3：安装选定技能或更新已安装技能时，将对应 `.codex/skills` 旧副本迁移到 `.agents/skills`；兼容既有技能改名映射。迁移成功后清理对应旧副本，重复执行不产生重复安装。
- R4：安装清单识别新旧路径；停用时清理该技能的新旧精确目录。只处理随包通用技能及明确迁移名称，不触碰无关技能、配置和凭证。
- R5：Flower 技能管理器、common 同步、内置 Plugin 更新与 Skill Garden 独立 common 安装器遵循一致规则。更新只维护已启用技能，dry-run 不修改目标。

## Acceptance Criteria

- [ ] AC1（R1、R2）：空目录安装两个以上选定技能，每个技能都同时出现在 `.agents/skills` 与 `.claude/skills`，不创建 `.codex/skills`、`.trellis` 或 `.flower`。
- [ ] AC2（R1、R2）：覆盖仅 `.codex`、仅 `.agents`、仅 `.claude`、共享平台与 Claude 并存；安装目录符合平台事实且重复安装结果一致。
- [ ] AC3（R3、R5）：仅旧目录、新旧并存、旧名称别名、无旧副本四类场景均得到唯一共享目录；定向安装不顺带迁移无关技能，更新不启用新技能。
- [ ] AC4（R3、R4）：沿用同名通用技能由随包快照刷新替换的既有语义；目标写入失败时旧副本仍保留；停用只移除指定技能，无关文件与配置不变。
- [ ] AC5（R5）：内置 Plugin dry-run 无写入，新目录写入与旧目录删除纳入既有事务；独立安装器与 Flower 的平台矩阵一致。
- [ ] AC6（R1-R5）：相关自动测试通过，README 与项目规范反映新路径和迁移行为。

## Background

- 需求来源：本会话的空目录安装问题与用户“按你建议来”的方向确认；完整行为收敛在 R1-R5。
- `src/lib/skill-catalog.js:11` 当前将 `.codex/skills` 设为主目标，`:26` 将 `.agents/skills` 设为历史目录；`:543` 无平台证据时仅回退 Claude。
- `src/commands/plugin-interactive.js:2003` 的 Skill Garden 入口复用 `src/commands/skill.js`；`:155` 调用 `installCommonSkills()`，不经过普通 Plugin 的平台选择。
- `src/lib/skill-catalog.js:301` 的同步计划被 `src/builtin-plugins/skill-garden/content-adapter.js:764` 复用；`vendor/skill-garden/scripts/install.sh:337` 单独实现 common 平台检测。
- 官方依据：`https://developers.openai.com/codex/skills/` 的项目技能目录为 `.agents/skills`；`https://code.claude.com/docs/en/skills#where-skills-live` 为 Claude 保留 `.claude/skills`。

## Non-Goals

- 不改变强化技能、普通 Plugin 的平台识别与安装契约，不新增平台选择交互。
- 不移动 `.common/.codex/skills` 源素材目录，不迁移用户级技能或任意自建技能。
- 不执行发版、推送或直接迁移当前仓库内已安装副本；实现验证使用临时目录。
