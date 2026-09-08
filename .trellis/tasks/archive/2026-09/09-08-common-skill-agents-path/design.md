# 通用技能目录统一设计

## Boundaries

- 核心逻辑在 `src/lib/skill-catalog.js`，复用现有 `installCommonSkills()`、`describeInstalledCommonSkillSync()`、`syncInstalledCommonSkills()`、`removeCommonSkills()`。
- `src/commands/plugin-interactive.js` 的内置 Skill Garden 入口继续调用 `src/commands/skill.js`，通用技能不建立 Plugin 声明或 Trellis 状态。
- `src/builtin-plugins/skill-garden/content-adapter.js` 消费同步计划，将迁移写入与删除放入既有事务；保留 shared ownership 和运行时文件排除契约。
- `vendor/skill-garden/scripts/install.sh` 的 common 分支同步平台与迁移规则。该脚本位于独立 Git 子仓，需单独审查 diff。

## Platform Selection

| 安装前平台目录 | common 安装目标 |
| --- | --- |
| 无 `.codex`、`.agents`、`.claude` | `.agents/skills` 与 `.claude/skills` |
| `.codex` 或 `.agents`，无 `.claude` | `.agents/skills` |
| 仅 `.claude` | `.claude/skills` |
| `.codex` 或 `.agents` 与 `.claude` 并存 | `.agents/skills` 与 `.claude/skills` |

- 将 canonical common 映射的 Codex target 改为 `.agents/skills`，历史目标改为 `.codex/skills`；源仍是 `.common/.codex/skills`。
- common 平台检测只选择物理目标，不据 `.agents` 推断 Gemini/Pi/Kimi 等逻辑平台，不修改 `ENHANCEMENT_SKILL_TARGETS` 或普通 Plugin detector。
- 每次安装在写入任何技能之前一次性计算目标集，整批复用，防止创建目录后默认值变化。

## Migration And Data Flow

1. Catalog 继续识别 canonical 与历史目录中的已安装技能。
2. 同步扫描仅枚举当前快照名称、有效改名映射及 tombstone 名称的精确路径。
3. 发现 `.codex/skills/<name>` 时，计划将对应当前快照写入 `.agents/skills/<最终名称>`；旧别名同时归一到最终名称。用目标路径为键去重，新旧并存只生成一份共享目标刷新。
4. 仅在来源 `SKILL.md` 存在且目标刷新已进入计划后，登记该旧路径删除。损坏的显式名称迁移声明继续采用既有 fail-closed 规则，不将失败的改名当 tombstone 删除。
5. `syncInstalledCommonSkills()` 先完成写入再处理旧路径删除；写入抛错时不执行后续删除。返回结构继续为 `refreshed/removed/refreshedPaths/removedPaths`。
6. builtin 内容 adapter 复用 `refreshes/removedTargets`，迁移全部经过 Transaction Writer；dry-run 只生成计划，项目本身零写入，失败由既有事务恢复。
7. 定向安装只处理本次名称及其明确旧别名。新目标成功写入且 `SKILL.md` 存在后清理对应 `.codex/skills`，不以目录迁移为由全量刷新其它 common 技能。
8. 停用继续遍历新旧精确根，删除所选当前技能并按既有规则清理空 skills 根，不删除 `.codex` 平台目录及其它设置。

## Compatibility

- 新旧同名内容并存时，沿用 `copyPath()` / `install_one` 的快照替换语义：新目录内容以当前随包快照为准，成功后删除旧副本。迁移不是用户自定义内容合并器。
- 独立安装器仅在 common 选择命中后迁移，保留全量 common 安装与定向安装差异；技能改名与目录改名应一次到达最终路径。
- 源素材 `.common/.codex/skills` 和 manifest 中 codex 源目录统计保持原意，无需移动整个素材树或更改快照 schema。
- README 和 `enhancements-model.md` 中“历史 `.agents/skills` 原地刷新”的描述更新为新契约；独立安装器 README 同步。
- 当前仓库未跟踪的用户技能和 telemetry 任务不属于修改范围。

## Validation And Rollback

- 重点验证空目录批量安装、单平台、多平台、新旧副本与旧名称叠加、写入失败、dry-run、重复更新和精确卸载。
- Node 集成测试复用临时目录和独立安装器临时 Git 仓库，不访问凭证或线上服务；设置 `FLOWER_NO_TELEMETRY=1`。
- 实现期只在临时目标执行迁移。代码回退需同时回退 Flower 核心映射与独立安装器；已迁移目录继续可被旧版 Flower 的历史目录扫描识别，但旧版新安装仍会使用 `.codex/skills`。
- 不新增业务版本号、发版动作或提交。需要同步快照时先确认 `scripts/sync-enhancements.mjs` 的输入范围；仅改安装脚本和说明不会改变 common 素材，不为了同步制造无关快照时间戳变更。
