# Claude 后台通知隔离探针

- Query：普通 Claude Code 主会话的 Bash 后台命令完成后，是否在无人输入时自动续接。
- Scope：本地 Linux、Claude Code 2.1.293、回环 Anthropic Messages mock。
- Date：2026-11-07。
- 状态：已运行普通 TUI。三秒后台计时自动续接、正常退出并停止任务、强杀专用 CLI 三个最小场景通过；见 [实际结果](../native-background-results.md)。没有向真实模型发送推理请求。

运行前由主会话审查脚本。普通 TUI 使用：

```bash
node .trellis/tasks/11-07-confirmation-timeout/research/probes/claude-background-probe.mjs --mode tui
```

首次设置阻塞时，脚本只输出脱敏 startup_tail，不自动批准主题、API key、工作区信任或 Bash 权限。此时结果是“证据不足”，主会话可审查隔离目录中的已知 fixture 后调整探针，不能据此改真实用户配置。

较低证据级别的流式对照：

```bash
node .trellis/tasks/11-07-confirmation-timeout/research/probes/claude-background-probe.mjs --mode stream-json
```

`--scenario idle|normal-exit|kill-cli` 选择最小场景；退出场景只允许 TUI。`--reuse-scratch` 只可复用本探针生成的临时目录。`--setup-input` 在外层 PTY 中允许手动处理专用实验的启动提示，第二次主请求之后停止转发；不将启动输入混作等待阶段输入。

正常退出实验会发送两次 Ctrl+D，并只在实际看到原生 “Exit and stop tasks” 菜单时确认关闭本次实验。强杀只针对已核实 PID / 启动身份的实验 CLI。两种场景都保持 mock 到观察窗口结束，不能靠立即关闭服务掩盖退出后的模型请求。

可加 `--bare` 作为隔离起点，但它改变默认 system prompt、自定义内容加载与部分后台行为；即使通过，也不能冒充普通 TUI 通过。默认不加 bare，不使用任何绕过权限或沙箱的 flag。

## 成功判据

1. 第一次主请求有 Bash 工具和本探针初始标记；mock 返回精确命令的 tool_use，run_in_background 为 true。
2. 第二次主请求含对应 tool_result；mock 返回 FLOWER_WAITING，且确实在 CLI 输出中观察到。
3. 保持 CLI 开着，之后八秒不写入任何输入；第三次主请求必须带首次出现的 `<task-notification>`、completed 状态和本探针任务标记，且发生在等待输出之后；mock 返回 FLOWER_RESUMED。
4. 观察到续接标记且无额外主请求、CLI 提前退出或协议异常。

不暴露 TaskOutput，只给模型 Bash；mock 从不返回轮询调用，辅助请求固定回答 FLOWER_AUXILIARY，不计入主请求。此探针目前核查 idle、正常退出和强杀的最小场景；尚不验证人工取消、恢复、授权或完整决策状态机。

## 隔离与清理

- 运行时创建 `.trellis-tmp/confirmation-timeout-claude-*`，包含专用 config、工作目录、仅打印标记的 timer.py、精确 Bash 允许规则及 summary.jsonl。
- `CLAUDE_CONFIG_DIR` 指向该临时 config；HOME 只按原值继承，不改 HOME/home/CODEX_HOME。凭证变量不继承、不读取、不记录；mock 使用固定 dummy API key。
- `--setting-sources ''`、显式 `--settings`、`--strict-mcp-config` 限制配置来源；关闭遥测、自动更新、feature flags、标题辅助请求和提示建议，不持久化会话提示历史。检测到 Linux 机器级受管配置时拒绝运行，避免未知路由覆盖。
- mock 绑定 127.0.0.1 随机端口，不转发任何上游；代理和 CONNECT 一律拒绝。API 只指向回环，不提供真实 key；但没有操作系统防火墙/网络命名空间，不能保证所有 CLI 辅助网络栈遵守代理。需要严格物理断网时应由主会话另加外部网络隔离。
- 记录只包含序号、时间、工具名、标记布尔值和脱敏启动提示，不存完整请求、prompt 或 headers。独立 config 中 CLI 自己可能产生诊断或其他状态，须与探针 summary 区分。
- 结束、总超时或 SIGINT/SIGTERM 会清理所追踪的 CLI 与后代、HTTP 连接和 server；进程清理用 `/proc` 启动时刻验证身份。探针自身被 SIGKILL 时 finally 无法运行，这不是本轮退出合同的实测证明。当前仅支持 Linux。

## 已核对的接口与文档

- 本机 `claude --help`：真实存在 --tools、--settings、--setting-sources、--strict-mcp-config、--permission-mode dontAsk、--no-chrome、--prompt-suggestions、--print、--input-format/--output-format stream-json、--no-session-persistence、--bare。
- [官方 CLI 参数](https://code.claude.com/docs/en/cli-reference)、[配置与作用域](https://code.claude.com/docs/en/settings)、[环境变量](https://code.claude.com/docs/en/env-vars)：API key 覆盖订阅、回环自定义地址、独立 CLAUDE_CONFIG_DIR 和非必要流量开关。
- [官方精确 Bash 规则](https://code.claude.com/docs/en/permissions#use-specifiers-for-fine-grained-control)：无通配符的 Bash(command) 精确匹配。
- [官方 SSE](https://platform.claude.com/docs/en/build-with-claude/streaming)：message_start → content_block_start/delta/stop → message_delta → message_stop；工具参数通过 input_json_delta 发送。
- 本机官方 `sdk-tools.d.ts:809` 的 BashInput 和 `:3297` 的 backgroundTaskId；仓库 `node_modules/node-pty/typings/node-pty.d.ts:18` 的 spawn、`:149` 的 onData、`:155` 的 onExit。

已知不足：首次 TUI 设置可能需要额外隔离 fixture；实测普通 TUI 的任务完成通知包含 completed 状态和计时任务说明。人工撤销、临界竞争、手动恢复、长时间等待和其他操作系统仍未验证，不能据三个短场景宣布产品验收完成。
