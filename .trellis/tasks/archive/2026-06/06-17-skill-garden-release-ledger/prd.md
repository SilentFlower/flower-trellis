# skill-garden finish-work 上线事项智能识别

## 背景

当前 Trellis 任务能保存 PRD、设计、实现计划和检查结果，但任务完成后如果涉及 SQL 变更、生产配置、上线批处理、数据修复、开关调整、回滚步骤等运行期事项，缺少一个稳定的任务级记录位置。正式上线时只能从聊天、提交记录或记忆中反推，风险较高。

用户明确倾向：不改 Trellis 本体，用 skill-garden 扩展；不在日常 workflow-state 中持续注入大段内容。更合理的触发点是任务真正结束、归档前的 `trellis-finish-work`。

## 目标

通过 skill-garden 的 `overrides/skills/` 增量覆写机制，把英文 `Release Operations Inference Step` 注入目标项目已有的 `trellis-finish-work` 入口；不维护一整份 `trellis-finish-work` skill 副本，不修改 `.trellis/workflow.md` 的 release 规则。同时新增 `trellis-release` 作为版本 / 上线批次聚合 skill，用来汇总多个任务的上线事项。

## 已确认事实

- flower-trellis 的强化包快照来自 `vendor/skill-garden/.trellis/<variant>/`，通过 `npm run sync` 同步到 `enhancements/<variant>/`。
- Trellis 0.6 的 skill-garden 可安装 `.agents/skills/trellis-*/SKILL.md` 与 `.claude/skills/trellis-*/SKILL.md` 两类 skill 副本。
- skill-garden 0.6 已有 `overrides/workflow.md` 模式；本任务新增类似的 `overrides/skills/<skill>.md` 模式，用于向目标已有 skill / command 注入 `BEGIN/END` 增量块。
- 本任务不新增 `vendor/skill-garden/.trellis/0.6/**/trellis-finish-work/SKILL.md`，避免维护 Trellis 上游 skill 副本。
- 本任务应先改 `vendor/skill-garden/.trellis/0.6/` 源，再运行 `npm run sync` 更新 `enhancements/0.6/` 快照；必要时同步当前项目已安装的 `.agents/skills/` 与 `.claude/skills/` 副本。

## 需求

- 新增 `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`，内容为英文增量覆写块。
- flower-trellis 安装 / 更新 0.6 强化包时，把上述增量块注入目标项目已有的：
  - `.agents/skills/trellis-finish-work/SKILL.md`
  - `.claude/skills/trellis-finish-work/SKILL.md`
  - `.claude/commands/trellis/finish-work.md`
- 注入逻辑只在目标文件存在时执行，不创建完整 `trellis-finish-work` 副本。
- 注入块必须幂等：重复运行先移除旧的同名 `skill-garden skill override` 块，再注入最新块。
- 首次注入前保留目标文件备份，后续保留既有备份。
- `--skills finish-work-enhancement` 应刷新 finish-work skill override，不刷新 workflow override；`--skills workflow-enhancement` 才刷新 workflow override。
- release inference 在归档任务前执行，但不得增加额外人工确认问题。
- 上线事项智能识别应读取当前任务已有 `release.md`；若不存在，应让 AI 根据当前任务 PRD、implement、git diff / recent commits、dirty path 分类和文件名信号自动判断：
  - 识别到 SQL、配置、批处理、部署脚本、数据修复、定时任务、权限、外部系统 / 依赖平台等上线事项：自动写入 `.trellis/tasks/<task>/release.md`。
  - 判断无上线事项：不创建 `release.md`，只在 finish-work 最终报告里简要说明“未识别上线事项”。
  - 信号不确定但存在上线风险：自动写入 `release.md`，并在结论中标记 `Needs human review`。
- `release.md` 应作为任务归档前产物，随任务一起进入 archive。
- 新增 `trellis-release` skill，作为版本 / 上线批次总结入口，汇总多个已完成或待上线任务的 `release.md`，输出 `.trellis/releases/<release-name>.md`。
- `trellis-release` 应支持从用户指定的版本名、日期范围、任务列表或当前任务上下文中收集任务；如果输入不足，应先读取本地任务目录再询问用户。
- 不修改 `workflow.md` hub 或 workflow-state sentinel，避免每轮上下文膨胀。
- 方案不得修改 Trellis CLI、本仓 `.trellis/scripts/task.py` 或 Trellis 本体模板源码。
- README 需要说明 skill-garden 0.6 通过 finish-work skill override 增加 release inference，并新增 `trellis-release` 聚合能力。

## `release.md` 内容要求

当智能识别决定写入 `release.md` 时，文件至少包含：

- Conclusion
- SQL Changes
- Configuration Changes
- Batch / Deployment Scripts / Data Repair
- External Systems / Dependent Platforms
- Release Order
- Rollback Notes
- Post-release Verification

说明：部署脚本、数据修复、一次性命令、定时任务触发等统一归入 `Batch / Deployment Scripts / Data Repair`；像 H0 接口中转平台这类不在当前代码仓内、但需要配合上线或发布的系统，归入 `External Systems / Dependent Platforms`。

明确无上线操作时可以不写入 `release.md`。存在不确定上线风险时应写入 `release.md`，结论明确标记 `Needs human review`。

## 验收标准

- [ ] `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md` 存在，且包含英文 `Release Operations Inference Step`。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`、`workflow-states/in_progress.md`、`workflow-states/in_progress-inline.md` 不包含 release inference 规则。
- [ ] 本任务不新增、不覆盖 `vendor/skill-garden/.trellis/0.6/**/trellis-finish-work/SKILL.md`。
- [ ] flower-trellis 能把 skill override 注入目标已有 `trellis-finish-work` skill / command，且重复运行不重复注入。
- [ ] `--skills finish-work-enhancement` 只刷新 finish-work skill override；`--skills workflow-enhancement` 只刷新 workflow override。
- [ ] release inference 能在识别到上线事项或不确定风险时自动写入 `release.md`，在明确无事项时跳过写入并报告判断结果，且不增加额外人工确认环节。
- [ ] `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md` 与 `.claude/skills/trellis-release/SKILL.md` 存在且内容一致。
- [ ] `trellis-release` skill 明确版本 / 上线批次汇总流程、任务选择、缺失 `release.md` 处理和写盘确认要求；缺失 `release.md` 默认视为“该任务未记录上线事项”，不直接阻塞汇总。
- [ ] 运行 `npm run sync` 后，`enhancements/0.6/` 与 `vendor/skill-garden/.trellis/0.6/` 对应 skill、override 文件同步。
- [ ] 当前项目已安装副本 `.agents/skills/trellis-release/`、`.claude/skills/trellis-release/` 同步新增，当前项目的 `trellis-finish-work` 入口带有 skill-garden override 注入块。
- [ ] README 中 Trellis 0.6 skill 列表已更新，并说明 release inference 来自 finish-work skill override，`trellis-release` 负责汇总。
- [ ] 验证命令通过：`npm run sync`、`node scripts/check-snapshot.mjs`、`node --check src/cli.js`、`for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done`、`git diff --check`。

## 非目标

- 不改 Trellis 上游包或 npm 全局安装目录。
- 不改 `.trellis/scripts/task.py`，不新增 task lifecycle hook。
- 不把上线事项塞进 `task.json` 的结构化字段。
- 不为第一版新增 JSON schema 或自动解析 SQL / 配置变更。
- 不自动执行上线操作；本功能只负责记录和汇总。
- 不维护 `trellis-finish-work` skill 完整副本。
