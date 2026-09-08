# Brief — 统一通用技能目录与空目录双平台安装

## Goal

- 统一 Codex 通用技能目录，让空目录安装后同时支持 Codex 和 Claude。

## Scope

- 调整 Flower 通用技能的安装、识别、更新、卸载，以及 Skill Garden 独立安装器；补齐测试和文档。

## Non-Goals

- 不改变强化技能或普通 Plugin 规则，不移动源素材、用户级技能或当前仓库安装副本，不发版或推送。

## Key Decisions

- Codex 写 `.agents/skills`，Claude 写 `.claude/skills`；无平台目录默认双装，已有平台按实际目录安装。
- 旧 `.codex/skills` 在对应技能安装或更新时迁移，兼容旧名称；新目录成功写入后才清理旧副本。

## Key Context

- 核心是 `src/lib/skill-catalog.js`；内置 Plugin 复用其同步计划，独立安装器位于 `vendor/skill-garden/scripts/install.sh`。

## Risks / Deferred

- 同名技能沿用随包快照替换语义，不合并自定义内容；迁移只处理明确通用技能目录，无关技能和配置保持不变。

## Acceptance

- 空目录批量双装、单平台安装、旧目录与旧名称迁移、重复执行和精确卸载均通过测试。
- 更新不启用未安装技能；写入失败保留旧副本，Plugin dry-run 零写入，真实迁移进入既有事务。
- Flower 与独立安装器行为一致，文档同步，无额外项目状态副作用。

## Next Step

- 实现与检查已通过，下一步进入规格收尾。
