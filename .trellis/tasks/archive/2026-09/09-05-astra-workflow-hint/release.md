# Release Operations

## Conclusion

Release operations exist.

本任务涉及 Flower 安装资产更新和可选配置开关。软件包发版及其他项目升级由维护者另行安排，本次归档只记录操作说明。以下事项来源均为 `[09-05-astra-workflow-hint]`。

## Evidence Checked

- `task.json`、`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`。
- `research/engineering-report.md`、`research/check-report.md`。
- 业务提交 `1d79835` 的实现与 README，任务记录提交 `2141ce2` 的文件集合及完成态。
- 当前任务目录归档前 clean，`main` 与 `origin/main` 同步；原先不存在 `release.md`。

## Drift Check

Missing release.md.

已补齐安装、开关、回滚和验证事项。本地混有先前插件安装变更的 `.flower` 文件仍未提交，不据此声称其他项目已升级。规划和检查文档中的阶段说明属于当时记录，当前生命周期以已提交的 `task.json` 为准。

## SQL Changes

None

## Configuration Changes

- 新增可选项目配置 `.trellis/config.yaml` → `codex.astra_workflow_hint`，缺省开启；无需新增配置即可使用。
- 要独立关闭，将 `astra_workflow_hint: false` 合并到已有 `codex` 映射中，保留其他字段。设为 `true` 或移除该字段恢复默认。
- 关闭只停止后续 SessionStart 新增提示，不能撤回历史上下文；无历史干扰的验证应新开会话。

## Batch / Deployment Scripts / Data Repair

- 使用包含本次提交的 Flower 版本后，由项目维护者通过正常 `flower-trellis update --enhance-only` 将源资产投影到项目；不得仅手改 `.codex` 或 `.trellis/scripts` 安装副本。
- 本项目已完成正常更新，隔离项目已完成 init、重复 update 和关闭配置保留验证。无数据库修复或一次性批处理。

## External Systems / Dependent Platforms

无需外部系统或权限变更。主动注入依赖 Codex SessionStart 输入的 `model` 和 `source`；已验证客户端为 `codex-cli 0.153.4`。

## Release Order

由维护者先提供包含本次代码的 Flower 版本，再按正常流程更新目标项目；更新后在新会话中验证。没有数据库或服务间先后依赖，本次未执行软件包发布。

## Rollback Notes

优先用独立配置关闭提示，原工作流继续保留。若需回滚代码，恢复相应 Flower 版本后通过正常资产投影更新项目；保留用户配置、原 Hook 额度和其他插件状态。

## Post-release Verification

- Astra 新会话仅 state 分段增加一份英文提示；5.5、缺失模型和未知别名零追加，原工作流正常。
- 手动或自动 compact 三段合计增加一份；普通 UserPromptSubmit 零新增。当前客户端的 clear 仅有脚本回归证据，不能视为宿主实测。
- 关闭配置后新提示零追加，重复更新保留该配置；全局禁用、resume 和非交互跳过保持原语义。
- 工程注入成功不代表行为改善：60 次对照的六项预设指标未显示提升，工具完成项增加 37.3%。后续效果评估需独立会话对照，参考 `research/behavior-report.md` 的口径与限制。
