# Brief — 修复跨平台 SessionStart 分段 Hook

## Goal

- 修复 Windows 上 Flower `state` 分段因标准流重配置触发的 `detach` 错误，并以可重复证据保证 Linux / Windows 的 Codex / Claude 均能正常交付 `state`、`rules`、`stages`。

## Scope

- 在 Flower 作者源中把 `state` 原生 Hook 改为独立 Python 子进程执行，保持宿主 JSON、原生副作用、诊断和后处理合同。
- 保持 `rules/stages` 的现有只读生成路径，不重复执行原生 `main()`。
- 将 SessionStart Python 测试改为 Windows/Linux 通用入口，补 `detach` 事故夹具、错误路径和六 handler 回归。
- 新增 Ubuntu / Windows GitHub Actions 专项矩阵，持续验证 Codex / Claude 两套模板。
- 经 Flower Plugin 安装链验证作者源投影、三 handler 注册、额度迁移、ownership 和幂等。
- 在统一的 Codex `0.154.0`、Claude Code `2.1.260` 基线上完成 Linux / Windows 脚本验证和四个真实宿主烟测。

## Non-Goals

- 不修改 Codex、Claude 或 Trellis 上游原生 Hook。
- 不修改 SessionStart 正文、工作流规则、平台注册范围或现有上下文预算阈值。
- 不把全局 npm 目录、`node_modules` 或单个已部署项目文件作为修复源。
- 本任务不发布 npm、不打 tag、不提交或推送代码。

## Key Decisions

- 根因按进程边界修复：`state` 使用 `sys.executable -X utf8`、`shell=False` 和 UTF-8 管道运行原生 Hook，不再把原生入口置于 `StringIO` 伪标准流中。
- 只隔离具有标准流重配置和会话副作用的 `state`；`rules/stages` 继续当前进程调用摘要生成器，避免重复绑定和无谓开销。
- 子进程空 stdout 保持跳过语义；stderr 透传，非零退出、非法 JSON、缺少唯一 workflow 块继续走现有可见注入错误。
- 不通过修改共享 `common._configure_stream()` 或伪造可 `detach` 的内存流规避问题，避免扩大共享运行时影响面。
- “四象限保证”由平台无关事故回归、Ubuntu/Windows CI、两系统实机六 handler 和四个真实宿主证据共同组成；CI 不冒充需要认证的真实宿主加载。

## Key Context

- 作者源：`src/assets/flower_session_start.py`；项目内 `.trellis/scripts/flower_session_start.py` 是受管投影，必须经 Plugin 安装链同步。
- 主要测试：`test/python/test_flower_session_start.py`、`test/js/platform-patches.test.js`、`test/js/apply-enhancements.test.js`、`test/js/ai-context-budget.test.js`。
- 平台配置合同：Codex / Claude 各三个 handler，仅匹配 `startup|clear|compact`，已有 30 秒宿主超时与 `additionalContextLimit` 迁移规则保持不变。
- state 内容必须等于原生上下文移除唯一完整 workflow 块后的内容；`rules + stages` 必须等于原 workflow 摘要；Astra 仍只增强 Codex state。
- 当前工作树另有用户未跟踪任务 `.trellis/tasks/09-05-telemetry-roadmap/`，实现与检查不得覆盖或纳入本任务。

## Risks / Deferred

- `state` 新增一次 Python 子进程启动开销，但仍受平台注册的 30 秒外层超时约束；不再增加第二套内部超时语义。
- 宿主可能不直接展示隐藏的注入正文；真实烟测需联合 Hook 执行记录与会话日志说明证据强度，不能把脚本输出成功当作宿主加载成功。
- Windows 升级前已运行的 Codex 会话不会热切换版本；真实宿主烟测前必须关闭并重开该会话。
- 发布、打 tag、提交和推送明确延后到单独授权。

## Acceptance

- 平台无关夹具在原生入口实际重配并 `detach` 标准流时仍返回合法 state JSON，旧故障被回归锁定。
- Linux 与 Windows 上 Codex / Claude 六个 handler 均退出 0、JSON 可解析、分段名准确、内容完整且无 `<trellis-injection-error>`。
- resume、全局禁用、Codex 非交互、原生跳过、损坏输出、stderr、并行、Astra、诊断和预算合同全部保持。
- Flower Plugin 隔离安装后的作者源与投影一致，两个平台注册正确，额度与无关 handler 保留，第二次应用零变化。
- Ubuntu / Windows GitHub Actions 专项矩阵通过，Windows 不依赖 `python3` 别名或系统代码页。
- 默认/strict 上下文预算、Patch/安装专项测试、完整 `npm test` 与 `git diff --check` 通过。
- Linux / Windows 分别完成 Codex / Claude 真实新会话烟测，报告精确版本、命令、退出状态、三段证据和宿主可见性限制。

## Next Step

- 首轮实现、Full Check-All、Update-Spec 与推送已完成。CI 夹具已改为自行创建开发者身份，干净检出下 Linux 与 Windows 原生 Python 各通过 14 个专项测试；修复已推送，GitHub Actions [运行 35121142010](https://github.com/SilentFlower/flower-trellis/actions/runs/35121142010) 的 Ubuntu 与 Windows job 均通过，本次返工完成。
