# 修复跨平台 SessionStart 分段 Hook

## Goal

修复 Flower SessionStart 分段包装器在 Windows 执行 `state` 时因标准流重配置触发的
`detach` 错误，并以可重复、可审计的证据保证 Linux / Windows 上 Codex / Claude
四个组合都能正常交付 `state`、`rules`、`stages` 三段上下文。

## Background

- Windows 项目升级至 Flower `0.6.8`、Trellis `0.6.14` 后，Codex 与 Claude 的分段注册均由
  `src/assets/flower_session_start.py` 投影生成。
- Windows 无 BOM 输入下，Codex `state` 连续三次稳定返回
  `Trellis SessionStart state 注入失败：detach`；`rules`、`stages` 正常。
- 同一 Windows 环境中直接运行原生 Codex SessionStart Hook 成功，退出码为 0，输出包含唯一
  `<trellis-workflow>`，证明故障位于 Flower 包装边界而非原生 Hook。
- 当前实现通过 `redirect_stdout(StringIO)` 在同进程调用原生 `main()`；Windows Trellis 编码初始化
  会重配置标准流，而 `StringIO` 没有可分离的底层字节流。
- Linux 与 Windows 均已安装 Codex 和 Claude，可执行四个真实宿主烟测；仓库当前只有 Ubuntu 发布工作流，
  没有持续运行 Windows / Linux 测试矩阵的 CI 工作流。
- 2026-09-16 已将验证基线统一为 Linux / Windows Codex `0.154.0`、Claude Code `2.1.260`；
  Windows PowerShell 与 `cmd.exe` 均已回读相同版本，后续四象限结果不得混用其它客户端版本。
- 持久化作者源是 `src/assets/flower_session_start.py`；项目内
  `.trellis/scripts/flower_session_start.py` 是 Flower Plugin 投影结果，不能作为唯一修复点。

## Requirements

- R1：`state` 必须在不把原生 Hook 暴露给内存伪标准流的隔离边界内执行，并继续消费完整宿主 JSON 输入。
- R2：Codex 与 Claude 在 Linux、Windows 上分别输出三个可解析的标准 Hook JSON；每份正文由对应的
  `<trellis-session-part name="state|rules|stages">` 独立闭合，且不包含
  `<trellis-injection-error>`。
- R3：分段前后的内容契约保持不变：`state` 等于原生上下文移除唯一完整 workflow 块后的内容，
  `rules + stages` 等于原 workflow 摘要；现有诊断、会话绑定副作用及 Astra 仅 Codex state 注入语义保留。
- R4：`resume`、`TRELLIS_HOOKS=0`、`TRELLIS_DISABLE_HOOKS=1`、Codex
  `CODEX_NON_INTERACTIVE=1` 继续零输出；损坏原生 Hook 继续输出可见诊断并退出 0。
- R5：平台注册仍仅覆盖 `startup|clear|compact`，Codex / Claude 各保留三个 handler，
  `additionalContextLimit` 迁移和无关 handler 保留规则不变。
- R6：修复不得通过修改全局 npm 安装目录、`node_modules` 或仅手改已部署项目实现；必须修改 Flower
  作者源并通过 Plugin 安装路径验证最终投影。
- R7：SessionStart 单段及总量继续满足上下文预算，不能以截断正文换取通过。
- R8：验证必须同时包含平台无关回归测试、Linux 实际执行、Windows 实际执行，以及两套系统上的
  Codex / Claude 真实宿主烟测；证据需区分“Hook 脚本输出成功”和“宿主实际加载成功”。
- R9：新增 GitHub Actions 的 Ubuntu / Windows 定向测试矩阵，在相关作者源、原生 Hook、测试或
  工作流变化时持续执行 Codex / Claude 六个分段回归；CI 不冒充需要本机认证的真实宿主烟测。

## Acceptance Criteria

- [ ] AC1：平台无关回归夹具模拟原生 Hook 重配置真实标准流；旧实现失败、修复后 `state` 成功，
  从而在非 Windows CI 也能锁定本次边界缺陷。
- [ ] AC2：Linux 上 Codex、Claude 的 `state/rules/stages` 六个 handler 全部退出 0、JSON 可解析、
  分段名准确、无注入错误，内容完整性断言通过。
- [ ] AC3：Windows 上使用无 BOM 宿主等价输入重复 AC2，Codex 与 Claude 六个 handler 全部通过，
  且原 `detach` 复现用例转为成功。
- [ ] AC4：Linux 与 Windows 分别新建 Codex、Claude 会话进行真实宿主烟测；会话证据能识别三段内容，
  或在宿主不暴露隐藏上下文时，以宿主 Hook 执行记录和最终会话日志共同证明加载结果。
- [ ] AC5：禁用、resume、损坏输出、并行执行、Astra 开关及模型边界、诊断保留、额度迁移等现有回归全部通过。
- [ ] AC6：Flower Plugin 隔离安装后的 Codex `.codex/hooks.json` 与 Claude `.claude/settings.json`
  均注册 `state/rules/stages` 三个 handler，部署资产与作者源一致且重复应用幂等。
- [ ] AC7：`test_flower_session_start.py`、上下文预算默认/strict、Patch/安装专项测试及完整 `npm test` 通过。
- [ ] AC8：验证报告明确记录四象限结果、实际客户端版本、命令、退出状态和任何宿主可见性限制；
  不把模拟测试表述成真实 Windows 或真实宿主证据。
- [ ] AC9：GitHub Actions 在 `ubuntu-latest` 与 `windows-latest` 上执行同一 SessionStart 专项测试，
  两个 job 均通过，且 Windows 测试不依赖 `python3` 命令别名或系统代码页。

## Out of Scope

- 修改 Codex 或 Claude 上游客户端实现。
- 修改 SessionStart 正文、工作流规则或现有上下文预算阈值。
- 发布 npm 新版本、打 tag 或推送代码。
