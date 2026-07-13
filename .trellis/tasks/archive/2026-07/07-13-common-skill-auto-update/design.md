# common skill 自动随新版更新 - Design

## Architecture

在现有 common skill catalog 上增加一个“同步已启用 common skill”的可复用能力，由 `applyEnhancements()` 仅在全量叠加时调用。

数据源分为两类：

- 当前可用技能：`enhancements/common/.common` 中的实际目录，继续由 `listCommonSnapshotNames()` 汇总。
- 历史移除技能：`enhancements/MANIFEST.json` 的 `common.removedSkills`，由 `npm run sync` 跨快照累计生成。

目标仓库不新增 common skill 状态文件。是否启用继续以允许路径中是否存在同名目录为准，从而保持 `flower-trellis skill` 的现有语义，并让用户手工删除目录后不会被更新重新安装。

## Runtime Flow

全量 `applyEnhancements(target)` 在完成工作流强化文件铺设后调用 common skill 同步：

1. 读取当前 common skill 名称和每个平台对应的快照源。
2. 对每个当前名称检查允许目标路径：
   - `.codex/skills/<name>` 使用 Codex 快照。
   - `.claude/skills/<name>` 使用 Claude 快照。
   - 历史 `.agents/skills/<name>` 使用 Codex 快照并原地刷新。
3. 仅当目标目录已经存在时，调用 `copyPath()` 覆盖整个目录；不存在时跳过，不创建平台目录。
4. 读取 `common.removedSkills`，对每个 tombstone 删除允许路径中的精确同名目录。
5. 返回 `{ refreshed, removed, refreshedPaths, removedPaths }`，由编排层输出简短中文摘要。
6. `refreshedPaths` 仅在本轮 stale-path 计算中加入保留集合，避免旧 manifest 把曾作为
   工作流强化项记录的 legacy common（如 `humanize-writing`）在刷新后再次删除；写入新
   manifest 时仍只保存当前工作流强化 `newPaths`，不接管 common skill。

`copyPath()` 的“先删旧目录再复制”语义确保新版已删除的技能内部文件不会残留，并使重复执行结果一致。

## Snapshot Tombstones

`scripts/sync-enhancements.mjs` 在删除旧 `enhancements/` 前先容错读取旧 `MANIFEST.json`：

1. 汇总旧 manifest 的 `codexSkills`、`claudeSkills`、`removedSkills`。
2. 完成新 `.common` 快照后汇总当前技能名称。
3. `removedSkills = 历史已移除 + 旧版当前技能 - 新版当前技能`，再移除重新出现于当前快照的名称并排序去重。
4. 首次迁移额外加入已知历史移除项 `sub2api-account-json-fix`，使已经升级到不含该技能快照的旧项目仍可清理残留。
5. 将结果写入新 `MANIFEST.json.common.removedSkills`。

该机制以后不需要人工逐版追加 tombstone：只要同步前保留仓库中已提交的旧 manifest，技能从 `.common` 删除时会自动进入累计列表。重复运行 `npm run sync` 结果除时间与 source commit 外保持稳定。

## Boundaries

- 只在无 `--skills` 的全量 `applyEnhancements()` 中同步 common skill。
- `flower-trellis update --dry-run` 不调用叠加链路；`--no-enhance` 跳过；全量 `--enhance-only` 正常同步。
- 不改变 `flower-trellis skill` 的菜单、排序、安装或停用入口。
- 不把 common 路径加入目标 `.flower-manifest.json.paths`，避免全量强化清理误接管可选技能。
- tombstone 只允许映射到固定 common skill 根目录加精确名称；不得把 manifest 内容直接拼成任意删除路径。

## Compatibility

- Canonical Codex/Claude 安装原地刷新，不向另一平台补装同名技能。
- 历史 `.agents/skills` 安装原地刷新或删除，不迁移、不复制到 `.codex/skills`。
- 当前快照新增技能没有目标目录，因此更新不会自动安装。
- 当前快照删除技能时，tombstone 会清理 canonical 与 legacy 路径中的精确同名目录。
- 若旧 manifest 缺失、损坏或没有 `common` 字段，同步脚本按空历史降级，但仍保留内置首次迁移 tombstone；运行时读取失败按空 tombstone 降级，不阻断其它强化更新。

## Risks And Controls

- 风险：误删用户同名自建技能。控制：只删除随包累计 tombstone 中的精确历史 common 名称，且路径限定为 common canonical/legacy 根目录。
- 风险：不同平台快照内容不同。控制：路径到源的映射集中定义并复用，不用任意一个平台快照覆盖全部目标。
- 风险：同步脚本清空快照后丢失历史 tombstone。控制：清空前读取旧 manifest，并通过连续两次 sync 的行为验证确保累计列表稳定。
- 回滚：移除运行时同步调用即可停止自动刷新；已写入的 `removedSkills` 只是发布元数据，不会单独执行删除。
