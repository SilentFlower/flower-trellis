# Release Operations

## Conclusion
Release operations exist.

本轮为纯代码变更，随 npm 包正常发版即可，无需数据库、配置或外部系统操作。但已安装本工具的存量项目携带精确版本锁，需要在升级后执行一次性放宽，否则这些项目的 Plugin 更新链路仍然不可用。

## Evidence Checked
- task.json（status=completed，completedAt=2026-08-06）
- prd.md（R1–R5 + R5.6/R5.7，AC1–AC13）
- design.md（含 Check-All 后的服务层范围修正）
- implement.md
- release.md（本轮新建，此前不存在）
- git commit `ee45d43`：8 个文件，`+1099 -147`
- 变更内容检索：无 `.sql` / migration / DDL / DML；无新增 `process.env` 读取（`DEBUG` / `FLOWER_DEBUG` 为改动前既有）；无部署脚本、cron、外部地址、密钥

## Drift Check
Missing release.md（首次生成）。任务材料、实现影响面与提交证据一致，无漂移。

## SQL Changes
None

## Configuration Changes
None

`printResult` 读取的 `DEBUG` / `FLOWER_DEBUG` 在改动前已存在于同一位置，不是新增配置项，无需在部署环境声明。

## Batch / Deployment Scripts / Data Repair
存量项目的一次性声明放宽 [08-06-improve-plugin-manager-ux]

- **触发条件**：项目 `.flower/plugins.json` 中存在精确版本锁（形如 `"version": "0.3.0"`），且其 Marketplace 已发布更高版本并移除旧版本。
- **症状**：任何 Plugin 生命周期命令（含 `ftl update` 走的 `plugin update flower/skill-garden`）都会失败于 `已锁定 Plugin 包不可重放` 或 `版本约束无法同时满足`。多个声明同时越界时互相死锁。
- **操作**：升级到含本次变更的版本后，在项目里执行 `ftl plugin` → 已安装页「检查全部更新」，按提示确认放宽；或非交互执行
  `ftl plugin update --widen <plugin>=^<latest> ...`（每个越界声明一项）。
- **责任边界**：需要人工确认跨兼容边界的版本跳变（如 `0.3.0 → ^0.4.0`），工具不会静默执行。
- **幂等性**：放宽后声明变为 `^x.y.z`，后续同大版本内的新版由普通 `ftl plugin update` 自动跟进，无需重复操作。

## External Systems / Dependent Platforms
None

组织内 rd-guide GitLab Marketplace 无需改动。本次变更是消费侧适配其「每个 Plugin 只保留最新版」的既有策略。

## Release Order
No special order.

本次未改动 `package.json` 版本号；实际发版按项目 `release-and-publishing.md` 的既有流程执行。

## Rollback Notes
Rollback code only.

回滚代码即可。已经被放宽为 `^x.y.z` 的 `plugins.json` 声明在旧版本下依然是合法 SemVer range，不会因回滚而损坏；旧版本只是重新失去批量放宽能力。

## Post-release Verification
按任务验收标准验证，重点覆盖：

- `ftl plugin list` 启动耗时明显下降，且模块图不含 `trellis-control`（AC1）
- 卸载单个 Plugin 的预览只列真实改动，幂等重写折叠为一行汇总；`--json` 的 `changes` 仍为全量（AC3/AC4）
- 从发现页安装全程不出现平台选择，且 `state.json` 平台与项目既有一致（AC5）
- 发现页对已安装 Plugin 显示徽标与 `0.3.0 → 0.4.0` 形式的可更新提示（AC7）
- 在存量精确锁项目上执行一次批量放宽，确认 `plugins.json` 变为 `^x.y.z`、lock 与 state 同步到新版本，且未越界的声明保持原样（AC9/AC12）

**遗留**：`npm test` 中 `test_workflow_state_hook.py` 有 5 项失败，源于 `vendor/skill-garden` 推进到 `200555a` 后 `state-untracked/content.md` 移除了 `Untracked work:` 文案而父仓测试未同步。与本任务改动无交集，需由 worktree-multirepo-handoff 线补同步后 AC11 方可转绿。
