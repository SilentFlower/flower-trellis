# Brief — common skill 自动随新版更新

## Goal

- 升级 `flower-trellis` 后，全量更新自动用当前包内快照刷新仓库中已启用的 common skill，保持未启用项不安装，并自动删除新版已移除的旧 common skill。

## Scope

- 在 common skill catalog 中增加已安装副本同步能力：按 `.codex/skills`、`.claude/skills` 和历史 `.agents/skills` 的实际同名目录原地覆盖或删除。
- 在 `applyEnhancements()` 的无 `--skills` 全量链路中执行同步，并输出刷新/删除摘要。
- 在 `scripts/sync-enhancements.mjs` 中跨快照累计 `enhancements/MANIFEST.json.common.removedSkills` tombstone，首次包含历史移除项 `sub2api-account-json-fix`。
- 更新 README 与项目强化包规范，并完成语法检查、快照同步和临时项目行为验证。

## Non-Goals

- 不自动启用目标仓库中原本不存在的 common skill。
- 不修改 `flower-trellis skill` 的交互菜单、排序和勾选语义。
- 不引入远程下载或项目侧 common skill 状态文件。
- 不改动 common 清单之外的用户自建 skill 或 Trellis 工作流强化 skill。

## Key Context

- 当前启用事实来自目标目录是否存在；手工删除目录后，更新不得重新安装。
- 当前技能按目标路径选择对应平台快照并使用 `copyPath()` 覆盖整个目录，确保新版删除的内部文件不残留。
- 历史 `.agents/skills/<name>` 原地刷新或删除，不迁移到 canonical 路径，避免双副本。
- tombstone 只能映射到固定 common 根目录下的精确名称，禁止扫描或删除其它路径。
- common skill 路径不写入目标 `.flower-manifest.json.paths`，避免与工作流强化 stale-path 清理混用。
- 仅无 `--skills` 的全量叠加执行同步；`--dry-run`、`--no-enhance` 和精细 `--skills` 不执行，全量 `--enhance-only` 执行。
- 发布快照必须遵守 `npm run sync`、快照审核和 `check-snapshot` 门禁。

## Acceptance

- 已安装 common skill 更新后与对应平台新版快照一致，内部旧文件被清理，重复执行保持幂等。
- 未安装项和新版新增项更新后仍不存在；双平台只刷新各自已存在的副本。
- 新版移除项通过 tombstone 自动删除 canonical/legacy 精确路径，同时保留其它用户技能。
- 旧版未记录 common 状态的仓库也能清理已知历史移除项。
- 全量/跳过/精细操作边界符合 PRD，并通过 Node.js 语法检查、`git diff --check`、连续快照同步和临时 Trellis 项目验证。

## Next Step

- 用户确认 planning artifacts 与本 brief 后运行 `task.py start`，随后进入 `trellis-route(implement)` 选择实现执行模式。
