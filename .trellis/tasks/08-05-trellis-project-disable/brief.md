# Brief — 实现 Trellis 项目级关闭与恢复

## Goal

- 为已安装 Trellis/Flower 的项目提供一个真正的项目级总开关：一次关闭全部已配置 AI 平台中的 Trellis 集成入口，并可在之后完整恢复。
- 关闭只影响 AI 可发现和可执行的集成层，保留 `.trellis/tasks/`、`.trellis/spec/`、`.trellis/workspace/`、当前任务状态和 Flower Plugin 所有权证据。

## Scope

- 新增 `flower-trellis trellis disable|enable|status`，同时支持 `ft` / `ftl` 别名；开关始终作用于整个项目，不提供平台级参数。
- `disable` 依据 Trellis 模板哈希、配置平台模板和 Flower Plugin state 识别全部受管入口，事务性 detach Skills、Agents、Commands、Prompts、Workflows、Hooks、Extensions、平台配置和 `AGENTS.md` Trellis 管理块。
- 对独占文件、`AGENTS.md` 管理块和共享 JSON 配置采用不同的安全变更策略；默认在无法安全拆分的用户修改前失败关闭，`--force` 也必须先保存完整恢复材料。
- 在 `.flower/trellis-control.json` 和 `.flower/trellis-detached/<transaction-id>/` 保存 schema 化状态、manifest、原始字节、mode、hash、owner 和共享配置片段。
- `enable` 先全量预检，再恢复关闭前现场，并通过当前 Trellis update 与 Flower Plugin replay 规范化到当前版本；失败时回滚为完整 disabled 状态。
- `status` 实际检查磁盘入口和恢复证据，区分 `enabled`、`disabled`、`drifted`、`repair-required` 和 `not-initialized`。
- Flower 的 `update`、`self-update` 项目更新链和 Plugin mutating lifecycle 在 disabled 项目上执行后，必须仍以完整 disabled 状态结束。
- 更新 CLI 帮助、README、Flower/Trellis 规范和自动化测试，并在隔离临时项目中验证 Claude + Codex 的关闭与恢复流程。

## Non-Goals

- 不从已经运行的 AI 会话中删除已加载上下文；disable/enable 后都要求重启 AI 会话。
- 不删除 Trellis 用户数据，不替代 `trellis uninstall`。
- 不提供单个平台开关，也不允许同一项目出现平台间混合启停状态。
- 不停止已经运行的 auto-loop、channel worker 或其它外部进程。
- 不拦截用户直接执行的上游 `trellis update`；该显式绕过可能重建入口，由 `status` 报告为 `drifted`。

## Key Context

- 当前 `no-trellis` 仅跳过单轮 workflow-state 注入，`TRELLIS_DISABLE_HOOKS=1` 仅关闭 Hook，都不是真正关闭。
- Trellis 的配置平台和原生所有权可从 `getConfiguredPlatforms()`、`collectPlatformTemplates()` 与 `.trellis/.template-hashes.json` 获取；Flower/Skill-Garden 投影所有权来自 `.flower/state.json`。
- 根级 `AGENTS.md` 使用 `<!-- TRELLIS:START -->` / `<!-- TRELLIS:END -->` 管理块，必须只删除该块并逐字节保留块外项目规则。
- Flower 已有 `ProjectStore`、`TransactionWriter`、update compensation 和 Plugin replay，可作为路径边界、原子写入、回滚与生命周期集成基础。
- `.trellis/**` 的任务、规范和运行数据默认不参与 detach；关闭平台注册入口即可阻止新会话调用保留在 `.trellis/scripts/` 中的实现文件。
- 共享 `.agents/skills/` 只处理有 Trellis 所有权证据的路径，不扫描目录名称或按前缀泛删第三方/用户内容。
- 恢复材料属于本机私有控制状态，应加入 `.flower/.gitignore`，且不能被普通 Plugin state 更新覆盖。

## Risks

- 多个平台可能共享同一 Skills 根目录，目标发现必须稳定去重并保留多 owner provenance。
- 共享 JSON 中的数组顺序和关闭期间用户修改可能造成恢复冲突，必须使用结构化操作而不是整文件覆盖。
- disabled update 会跨 control transaction、Trellis update compensation 和 Plugin transaction，故障注入必须证明最终状态只会是完整 disabled 或完整 enabled。
- 损坏 manifest、恢复冲突、软链、特殊文件和路径逃逸必须 fail closed，并保留 `repair-required` 诊断证据。
- 当前 AI 会话可能缓存已发现的指令和 Skills，CLI 只能保证重启后的新会话不再加载。

## Acceptance

- 在同时配置 Claude 和 Codex 的标准项目上，一次 disable 后所有 Trellis 入口均不可发现，Trellis 用户数据、active task 和 Flower 声明/锁/state 保持完整。
- `AGENTS.md` 块外内容与共享 JSON 中的无关用户配置在关闭和恢复后均保留。
- 修改过且无法安全拆分的目标在 preflight 阶段阻断写入；dry-run 返回相同目标和冲突但零写入。
- enable 可完整恢复全部平台并升级到当前 Trellis/Flower 版本；任意中途故障都回滚到完整 disabled 状态。
- Flower update、self-update 和 Plugin lifecycle 不会在 disabled 项目中留下可发现入口；直接上游 update 造成的重建可被 `status` 识别为 `drifted`。
- 重复 disable、enable、status 幂等；软链、路径逃逸、损坏恢复材料、恢复冲突和故障回滚均有自动化覆盖。
- Node 测试、语法检查、完整 `npm test`、`git diff --check`、快照一致性、compiled targets 和隔离项目 dogfood 全部通过。

## Current State

- 任务已进入 `in_progress`，实现、问题修复、回归测试与规范同步均已完成；当前等待最终 Full Check-All 验证全部验收条件。
