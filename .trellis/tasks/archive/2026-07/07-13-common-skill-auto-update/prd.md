# common skill 自动随新版更新

## Goal

当用户升级 `flower-trellis` 并对已有 Trellis 仓库执行正常更新时，自动使用当前版本随包发布的 common skill 快照刷新该仓库中已经启用的同名技能，避免用户先停用再重新启用；未启用的 common skill 必须继续保持未安装。

## Background

- common skill 快照来自 `enhancements/common/.common`，通过 `flower-trellis skill` 按目标平台安装到 `.codex/skills/<name>` 或 `.claude/skills/<name>`。
- 当前安装状态仅通过目标仓库中同名技能目录是否存在来判断，覆盖 canonical 路径和历史 `.agents/skills/<name>` 路径（`src/lib/skill-catalog.js:258`）。
- `installCommonSkills()` 已能从快照覆盖式复制指定技能，但交互菜单只对“原本未安装、最终被勾选”的技能调用它；已安装技能不会被重新复制（`src/lib/skill-catalog.js:356`、`src/commands/skill.js:133`）。
- 正常 `flower-trellis update` 会调用 `applyEnhancements()` 重新叠加强化包，但当前流水线没有刷新 common skill（`src/commands/update.js:48`、`src/lib/apply-enhancements.js:47`）。
- `copyPath()` 会先删除旧技能目录再递归复制新快照，因此可以同步清理新版中已移除的技能内部文件，保持重复执行幂等（`src/lib/fs-utils.js:14`）。

## Requirements

- R1：正常的全量强化叠加必须扫描当前 common skill 快照，并识别目标仓库中已经存在的同名 common skill。
- R2：对已启用且当前快照仍包含的 common skill，必须使用对应平台的新版快照覆盖整个技能目录。
- R3：目标仓库中不存在同名目录的 common skill 必须保持未安装；更新过程不得因为新快照新增了 skill 而自动启用它。
- R4：刷新必须跟随目标仓库实际平台，只处理已存在的 canonical common skill 目标路径，不创建未启用的平台目录。
- R5：历史 `.agents/skills/<name>` common skill 必须在原路径刷新或删除，不迁移到 canonical 路径，避免更新过程产生双副本或改变旧仓库加载位置。
- R6：common skill 的本地修改视为已安装副本内容，正常更新时允许被新版快照覆盖；行为与现有 `copyPath()` 的覆盖式铺设语义一致。
- R7：`--dry-run`、`--no-enhance` 不得写入或刷新 common skill；`--enhance-only` 的全量强化叠加应执行刷新。
- R8：带 `--skills` 的精细强化操作不得顺带刷新全部 common skill，避免超出用户指定范围。
- R9：刷新过程必须输出简短中文摘要，能看出刷新数量或没有已启用 common skill，且不得把 common skill 混入工作流强化项 manifest 的精确清理路径。
- R10：实现应复用 `src/lib/skill-catalog.js` 的 common 快照、平台映射和安装状态语义，不维护第二套名称清单。
- R11：若目标仓库中已安装的 common skill 已从新版快照中移除，更新时必须自动删除该技能的 Flower 管理副本，不保留废弃版本。
- R12：自动删除必须基于可审计的 Flower 管理状态或随包发布的历史移除声明，只能删除精确 common skill 路径，不能通过扫描并清空整个技能目录来猜测归属。
- R13：目标路径是否存在继续作为“当前启用”事实；若用户在菜单外手动删除技能目录，后续更新不得重新安装它。

## Technical Notes

- 随包 `enhancements/MANIFEST.json` 的 `common` 区域应累计记录已从快照移除的 common skill 名称，作为旧仓库精确清理的 tombstone；首次引入时需要包含已知历史移除项 `sub2api-account-json-fix`。
- 当前快照内的技能只刷新目标仓库中已经存在的精确路径；tombstone 只删除允许的 canonical/legacy 精确路径。两者都不能扫描或改动其它名称。
- common skill 不写入目标 `.flower-manifest.json.paths`，避免与全量工作流强化项的 stale-path 清理混用；启用事实继续来自目标目录。

## Acceptance Criteria

- [ ] AC1：目标仓库已安装某个 common skill，快照内容升级后执行 `flower-trellis update`，该技能目录与新版对应平台快照一致。
- [ ] AC2：目标仓库未安装的 common skill 在更新后仍不存在，包括新版新增的 common skill。
- [ ] AC3：同时存在 `.codex` 与 `.claude` 平台目录时，只刷新各自已经安装的同名 common skill，不为另一平台补装未启用副本。
- [ ] AC4：新版快照删除技能内部文件后，更新会清除目标技能目录里的对应旧文件，不留下陈旧内容。
- [ ] AC5：重复执行更新结果一致，不重复创建目录或产生额外状态漂移。
- [ ] AC6：`--dry-run`、`--no-enhance`、带 `--skills` 的精细操作不刷新 common skill；全量 `--enhance-only` 会刷新。
- [ ] AC7：历史 `.agents/skills/<name>` 安装场景有明确且经过验证的兼容行为，不产生 canonical 与 legacy 双副本。
- [ ] AC8：通过全部 Node.js 语法检查，并使用临时 Trellis 项目验证已安装刷新、未安装保持、跨平台和幂等场景。
- [ ] AC9：已安装 common skill 从新版快照移除后，更新会自动删除其 canonical 或 legacy 管理副本，同时不删除同目录下其它用户自建 skill。
- [ ] AC10：从尚未记录 common skill 状态的旧版目标仓库升级时，已知历史移除项也能完成一次性清理。

## Out Of Scope

- 自动启用任何用户未选择的 common skill。
- 修改 `flower-trellis skill` 的交互菜单和勾选语义。
- 为 common skill 引入远程下载；仍只使用当前 `flower-trellis` 包内快照。
- 覆盖不在 common 快照清单中的用户自建 skill 或 Trellis 工作流强化 skill。
