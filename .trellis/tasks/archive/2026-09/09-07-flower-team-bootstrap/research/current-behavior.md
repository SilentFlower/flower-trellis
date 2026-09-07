# 团队克隆安装链路调研与进度

## 本次范围与基线

- 任务：`09-07-flower-team-bootstrap`，状态 `in_progress`；最终 Brief 已审阅，已完成实现并进入 Check-All。
- 前置 worktree 任务已完成并推送；不重新打开，不自动归档。
- `task.json.meta.intentRouting.baseline` 保存新任务开始前 19 个变更条目；尤其两份 `.flower` 声明/锁是既有修改。
- 产品代码、两份 canonical skill 和 enhancements 已更新；验证结果及待处理问题见 [检查记录](../check-report.md)。

以下“Git 共享记录”至“后续补充证据”保留实施前的调研事实，路径行号以调研时源码为准，不表示本轮最终行为。最终契约以 design.md 和已更新 spec 为准。

## Git 共享记录

- `src/plugin/state/project-store.js` 的 `REQUIRED_IGNORE_RULES` 忽略 `state.json`、`cache/`、`transactions/`、`trellis-control.json`、`trellis-detached/`、`*.tmp`。
- 声明 `plugins.json` 和锁 `plugin-lock.json` 是可共享数据；本地状态和缓存不能因为根规则调整而一并放开。
- `settings.json` 包含本地更新偏好，本任务应保持其本地性质。
- 根 `.gitignore` 存在时才调整；需用真实 Git 验证父目录排除、反选规则和 `.flower/.gitignore` 的叠加效果。
- 可研究带标记的白名单块：放开 `/.flower/`，默认忽略其内容，仅反选 `.gitignore`、`plugins.json`、`plugin-lock.json`。不是已经批准或验证的最终规则。
- `test/js/plugin-e2e-local.test.js` 验证普通插件可以安装到没有 `.trellis` 的项目，不能把 `.flower` 搬入 `.trellis`。

## 旧 manifest 的读取与删除

- `src/lib/manifest.js` 提供 `readManifest`、`readLegacyManifestStatus`、`readUpdateCheck`、`writeUpdateCheck`。
- `readUpdateCheck` 在现代 settings 不可用时回退旧 manifest 策略；现代缓存缺失时回退旧缓存。
- `writeUpdateCheck` 只有包含策略补丁时才写现代 settings；单纯写缓存不能证明旧策略已经迁移。规划删除时必须单独处理此点。
- `src/builtin-plugins/skill-garden/content-adapter.js:857` 在无现代 state 时校验旧 manifest、路径和同版本内容漂移，成功后只返回 migration 标记，不删除旧文件。
- `.trellis/spec/flower-trellis/cli/config-and-state.md` 当前 Plugin State And Legacy Migration 明确要求成功迁移保留旧文件字节；本次需求会改变此契约及迁移测试。
- 当前项目旧记录为 `0.5.1`，现代锁和 state 为 `0.6.6`。旧文件可能误导缺少现代记录的团队克隆。
- 旧记录仍被 CLI 版本显示、self-check、worktree 诊断、telemetry context、update-check 配置显示和迁移入口兼容读取。成功迁移删除文件与删除全部兼容读取不是同一件事。
- `src/lib/manifest.js` 导出的旧 `writeManifest` 仅见测试夹具使用；`src/lib/update-transaction.js` 内部同名函数写的是事务快照 `manifest.json`，不能按名称误删。

## 事务与升级入口

- `src/plugin/install/install-planner.js` 接受内容 `write/remove` mutation，校验路径、ownership、冲突；既有文件需要明确的 `allowUnownedWrite/allowUnownedRemove` 依据。
- `src/plugin/install/transaction-writer.js` 对目标校验 `beforeHash/afterHash`，dry-run 在写入前返回；正常执行备份目标、执行 mutation，再写声明、锁和最终 state。
- 同一 writer 的异常路径倒序恢复已完成的项目记录和 mutation；恢复失败保留事务证据并报 `TRANSACTION_REPAIR_REQUIRED`。
- 新增根忽略规则、策略迁移和旧 manifest 删除应作为受控事务变更研究，不在成功返回后追加无回滚副作用。具体集成接口尚待设计。
- `src/commands/update.js` 的正常升级外层另有补偿快照；`--enhance-only` 依赖插件事务。
- `src/lib/update-transaction.js` 默认范围含 `.flower`、受管目录和 `AGENTS.md`，不含根 `.gitignore`；`onPreflight` 会按计划目标扩展快照，需验证新目标进入该链路。
- `--no-enhance` 冻结 Skill-Garden，未真正迁移旧项目时不能先删其唯一记录；最终设计需明确该跳过边界。
- shared 内容不应成为整份根 `.gitignore` 的独占 ownership，避免后续用户编辑或插件移除被错误判定为受管漂移/可删除。

## CLI 缺失与启动 hook

- `src/assets/flower_update_hook.py` 是随项目分发的 Python 标准库脚本，在本机无 Node CLI 时仍可检测并输出上下文。
- `_run_self_check` 当前调用 `flower-trellis self-check --json --target ...`；找不到可执行文件、权限失败和超时均返回空值。`main` 仅对真正可更新的结果输出，因而 CLI 缺失静默。
- 既有 `_emit_context` 输出 Codex/Claude 接受的 `SessionStart.additionalContext` 与 `systemMessage`，可复用协议。
- 缺少 CLI、不可执行、超时、异常输出应区分，不能都引导重复安装。
- 安装版本优先取可验证的项目锁；缺少或损坏锁不能回退过时 legacy 版本并宣称可靠。
- hook 负责检测和提供助手上下文；安装动作放在对话中执行。用户已确认先向新成员确认，再安装项目锁定版本。
- `src/patches/platforms/claude/startup-update-hook/patch.json` 与 `src/patches/platforms/codex/session-start-hooks/patch.json` 已注册 Flower hook，匹配 `startup`；保持独立于 Trellis state/rules/stages。
- `test/python/test_flower_update_hook.py` 目前只覆盖 project_unknown 静默和两个真实更新状态；需要补实际 CLI 缺失、版本读取与输出测试。
- 不能宣称禁用 hooks 或不支持该入口的平台也会自动执行；可在最终设计中选择轻量 skill 回退入口，避免把长安装流程复制到多个载荷。

## 后续补充证据

- `ProjectStore.ensureLayout()` 在 TransactionWriter 保存目标备份之前写局部忽略文件；`#writeJson` 也会再次调用，新规则必须在首次写入前保留旧字节。
- package.json 的 CLI 别名为 flower-trellis/ftl/ft，声明 Node >=18.17.0；实际依赖由 npm 校验，不保证任意 Node 环境可安装。
- `scripts/sync-global-trellis.mjs` 在全局 npm 安装 postinstall 中同步全局 Trellis，确认文案需要说明本机命令环境变化。
- Flower 平台 Bundle 为 `src/patches/bundles/flower-platform-integration.json`，属于 full-only，自动入口沿用 Codex/Claude。
- 两份 canonical trellis-flower-update 当前直接调用 CLI self-check，可用 bootstrap-only 做手动入口兜底，无需改 generic trellis-start 任务路由 Patch。

## 当前进度

- 安装 UX 已确认，PRD 已移除 Open Question。
- design.md、implement.md 和真实 JSONL 已形成，最终选择以三件套为准。
- 最终 Brief 已完整展示并获确认；实现步骤 1 至 4 完成，route 为 inline implement / inline Check-All。
- 首次全量 npm test、语法及隔离安装/升级/预览通过；发现的 `FBK-001` 已按“修复全部”授权修复，Python 9/9 与部署/分发回归 19/19 通过。
- 复用首次 full 证据的 light 重检通过，剩余 CHK/FBK 为 0；规范复核结果为 written，已修正 enhancements-model.md 的旧 manifest 保留描述并核对实现、测试及格式。当前进入 trellis-push 提交计划阶段，未提交、推送、发布或升级当前工作目录。
