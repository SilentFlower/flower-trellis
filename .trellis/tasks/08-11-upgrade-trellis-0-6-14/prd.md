# 升级上游 Trellis 至 0.6.14

## Goal

将 Flower-Trellis 捆绑的上游 Trellis 精确基线从 `0.6.12` 升级到稳定版 `0.6.14`，完整吸收 `0.6.13`、`0.6.14` 的上游修复，同时保持 Flower 已有更新入口、Patch fail-closed、任务状态完整性、路由、Check-All、自动循环、Task Brief 和升级事务等加强功能正常且无语义回归。

## Background

- 当前 `package.json` 精确依赖 `@mindfoldhq/trellis: 0.6.12`，Skill-Garden `compatibility.json` 仅把 `0.6.12` 标记为 tested baseline。
- 上游正式最新版为 `0.6.14`；`0.6.13` 与 `0.6.14` 的 migration manifest 均声明 `breaking=false`、`recommendMigrate=false`。
- 在隔离的官方 `0.6.14` 全平台 fixture 上运行当前 Flower Patch 预检，共出现 20 条 required 失败，归并后只有两个根因：
  - `session-context-update-boundary` 中 2 个 operation 因上游更新提示重构而失配。
  - `trellis-meta-managed-platform-skill-roots` 在 18 个平台副本上因上游 configurator 文档重构而失配。
- 直接把依赖改成 `0.6.14` 后，Flower CLI、更新事务和平台控制定向测试 57 项中 56 项通过；唯一失败是测试把目标版本硬编码为 `0.6.12`。其余已观察失败均来自上述 Patch 预检冲突。
- 上一轮 `0.6.12` 升级已确认的 Flower/Trellis 所有权边界继续有效，本任务不重新引入第二套 owner。

## Requirements

### R1. 精确升级基线

- 把 `@mindfoldhq/trellis` 与锁文件中的 `@mindfoldhq/trellis-core` 升级到精确版本 `0.6.14`。
- 新版 Flower 只把 `0.6.14` 声明为 `testedVersions`；保留 `compatibleLine=0.6`、同线未测试版本 warning 和新主/次版本 fail-closed 策略。
- 正常 `flower-trellis update` 必须继续支持从 Trellis `0.6.12` 项目升级到捆绑的 `0.6.14`，但新版 Patch 不承诺直接在仍停留于 `0.6.12` 的项目上执行 `--enhance-only`。

### R2. 保持 Flower 更新入口唯一

- Flower 的启动更新提示、人工确认、`self-update`、Plugin 重放和更新后 Push 链继续是唯一用户可见更新入口。
- 适配上游公开的 `get_update_hint()` 与共享 SessionStart relay，删除 Trellis 原生 `run trellis update` 提示链，但保留 `0.6.14` 的 `<first-reply-notice>`、会话上下文和其它 SessionStart 输出。
- Patch 必须继续使用窄 selector、已知 baseline、required preflight 和最终冲突断言；不得用 whole-file replacement 覆盖共享 SessionStart Hook。

### R3. 吸收上游跨平台会话与 Hook 修复

- 保留 `0.6.13` 新增的 Gemini、Qoder、CodeBuddy、Droid、Trae、ZCode shell-ticket 会话身份桥接与环境变量去重。
- 保留 `0.6.14` 对 CodeBuddy、ZCode、Trae 的平台检测顺序修复，以及 CodeBuddy `cwd=/` fallback。
- 保留 CodeBuddy `execute_command/task`、Trae `RunCommand`、Qoder `run_in_terminal` 的 PreToolUse matcher 更新。
- Flower 的 active-task 损坏状态保护、原子写入、fallback 清理和结构化结果不得覆盖或绕过这些新会话识别路径。

### R4. 重定基线 Meta 与 memory 能力

- 按 `0.6.14` 的 `collect<Platform>Templates()` 单一模板来源重写 Flower 管理的 `trellis-meta` 平台 Skill Root 章节，同时保留 21 个平台 root、共享 `.agents/skills` 和 Flower ownership 说明。
- 继承 `trellis mem` 对压缩后隐藏 turn 的恢复和 Grok session 读取能力。
- 让 Flower 投影的 `trellis-session-insight` 说明与 `0.6.14` Grok 能力一致；不在本任务中新增上游尚未支持的 OpenCode memory reader。

### R5. 保持 canonical、快照和最终产物一致

- 所有 Skill-Garden 修改先落在 `vendor/skill-garden/.trellis/0.6/`，再同步 `enhancements/0.6/`。
- 重新生成 `vendor/skill-garden/compiled-targets/0.6.14/full`，移除旧的精确 `0.6.12` compiled target 基线。
- 更新 Patch targets、conflicts、fixture、测试与规范中的精确版本引用；内容、selector 和 baseline 文件继续继承目标语言与原文字节。
- 当前 dogfood 项目重放后必须与 canonical/compiled target 的关键最终语义一致，第二次重放为零变化。

### R6. 保持升级事务和失败补偿

- 跨版本 `update --dry-run` 必须在项目外沙箱完成 Trellis `0.6.12 -> 0.6.14` 升级和 Plugin dry-run，来源项目零写入。
- 真实升级中，Trellis 成功但 Skill-Garden/Plugin replay 失败时，Flower 必须恢复旧受管状态并报告未恢复路径；不得留下部分 `0.6.14` 强化产物。
- required Patch 预检失败必须继续 zero-write，不允许通过放宽 selector 或跳过 conflict 掩盖漂移。

### R7. 回归验证 Flower 所有权

- Flower 的 `trellis-route`、audit-only Check-All、auto-loop、untracked flow、Task Brief、task lifecycle、spec/push/finish-work owner 必须保持现有最终语义。
- 平台、Hook、Active Task、Plugin Runtime、update transaction、Patch Engine、上下文预算、输出模板和发布快照相关测试必须全部通过。
- 长期规范和 README 中对当前 Trellis baseline、平台能力或更新链的陈述必须同步到 `0.6.14`。

## Acceptance Criteria

- [ ] `package.json`、`package-lock.json` 和 `flower-trellis -v` 均显示捆绑 Trellis `0.6.14`，不存在运行时 Trellis/Core 版本分裂。
- [ ] 官方 `0.6.14` 全平台 fixture 上 required Patch preflight、conflict audit 和 compiled target 检查均为零错误。
- [ ] 最终 SessionStart 产物不包含 Trellis 原生更新提示或 `get_update_hint()` relay，只保留 Flower 更新入口，并保留 `<first-reply-notice>` 与其它上游 SessionStart 能力。
- [ ] Gemini、Qoder、CodeBuddy、Droid、Trae、ZCode 的 shell-ticket 会话身份测试通过；CodeBuddy/ZCode/Trae 平台检测、CodeBuddy cwd fallback 和新增 matcher 均有最终产物断言。
- [ ] Flower active-task 状态完整性测试继续覆盖 missing/corrupt/io_error、原子写入、clear/fallback，并证明新会话身份路径未被覆盖。
- [ ] `trellis-meta` 最终产物准确描述 `0.6.14` configurator 架构和 21 个平台 root；各平台副本与 canonical 内容一致。
- [ ] `trellis mem` 压缩恢复与 Grok 支持可用，`trellis-session-insight` 说明与运行时能力一致且未虚构 OpenCode 支持。
- [ ] `compatibility.json.testedVersions` 仅为 `0.6.14`；同线未测试版本仍 warning，`0.7+` 仍由兼容门禁阻断。
- [ ] 从 `0.6.12` 项目到 `0.6.14` 的普通 update dry-run 来源树零写入；失败补偿、`--no-enhance` 和 `--enhance-only` 边界测试通过。
- [ ] `npm run sync`、完整测试、Patch/compiled target、strict context budget、输出模板、真实 dry-run、npm pack、dogfood 二次重放和双仓 diff check 全部通过。

## Non-Goals

- 不升级或兼容 `0.7.0-beta.*`。
- 不同时维护新版 Flower 对 Trellis `0.6.12` 与 `0.6.14` 的双 tested baseline。
- 不改变 Flower 已确认的路由、检查、任务生命周期、更新确认或 Plugin ownership 产品策略。
- 不在本任务内执行 npm 发布、打 tag 或决定 Flower 的发行版本号。
- 不借升级机会重构无关 Plugin、遥测、worktree 或 common Skill 功能。
