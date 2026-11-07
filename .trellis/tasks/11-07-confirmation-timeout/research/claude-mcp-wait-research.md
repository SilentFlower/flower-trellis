# Research: Claude 统一前台入口与标准 MCP 等待适配

- Query：在普通 Claude Code 2.1.293 TUI 中仅暴露本地 wait 工具，保持当前回合前台等待，并由根控制器拥有输入取消与退出边界。
- Scope：mixed；旧隔离探针、本机官方安装元数据、官方 CLI/MCP/权限文档。
- Date：2026-11-07。
- 状态：用户已接受两平台统一前台入口与标准 MCP 等待工具，并授权隔离实验；任务仍为 planning。本轮只准备适配器与研究，没有启动 CLI、MCP 进程、真实 API 或 PTY。

## Findings

### 已提供的薄接口

`research/probes/claude-mcp-adapter.mjs` 导出：

| 接口 | 输入和结果 | 所有权 |
| --- | --- | --- |
| `prepareClaude({sandbox,mockPort,controlPort,nonce,mcpServerPath,requestId})` | 同步返回 `{executable,args,env,version}`；requestId 固定 probe；version 从官方已安装 package.json 得到 2.1.293 | 只在调用时创建 sandbox 内专用设置；不启动进程 |
| `sendClaudeMessage(response,body,content)` | 按 SSE 或 JSON 回应；支持先 text FLOWER_MCP_PLAN，再同一响应 tool_use | HTTP server、请求计数和工具上下文字节统计归根控制器 |
| `createClaudeToolCall(body,requestId)` | 从真实 body.tools 选择含 flower_confirmation_probe、末尾为 wait 的唯一工具，核对 schema 后返回 tool_use；否则 null 与脱敏诊断 | 不猜完整工具名，不自动搜索、重试或补跑 |

`prepareClaude` 的 args **没有附加初始 prompt**；根控制器应把初始提示词作为最后一个位置参数，或在 PTY 就绪后输入。PTY 的 cwd 必须是传入的 sandbox。适配器不会操作用户键盘，也不会自行取消或恢复主会话。

### 单服务器、单 MCP 工具如何进入请求

1. 单次 `--mcp-config <sandbox/.claude-confirmation-probe/mcp.json>` 提供且仅提供一个服务器；`--strict-mcp-config` 排除其他 MCP 配置。
2. `--tools ''` 移除内置工具；官方明确该 flag **不影响 MCP 工具**，不能把 MCP 工具写进内置工具列表后假定它会按名单加载。EndConversation 在 MCP 工具仍存在时可能继续保留，因此“单工具”指一个 MCP 工具，不保证整个 API 请求只有一个条目。[官方 CLI 参数](https://code.claude.com/docs/en/cli-reference)。
3. `ENABLE_TOOL_SEARCH=false` 让 MCP 定义 upfront，避免首次请求只有搜索入口或延期占位；不额外引入 ToolSearch。[官方 MCP 工具搜索](https://code.claude.com/docs/en/mcp#configure-tool-search)。
4. 实际 MCP server 名为 flower_confirmation_probe，server tools/list 只提供 wait；预置精确权限名为 `mcp__flower_confirmation_probe__wait`，不用服务器通配规则。`dontAsk` 只执行已有允许项，不能代替信任目录或批准任意工具。工具名公共格式及权限匹配见[官方 MCP 权限](https://code.claude.com/docs/en/permissions#mcp)。
5. 创建 tool_use 时仍从实际 body.tools 取 name，而非使用预置权限名作为“已观测名称”；若权限名与实际名不同，应由根审查真实定义与拒绝结果，适配器不扩大权限。

要求的实际 schema 为：

```json
{"type":"object","properties":{"request_id":{"type":"string"}},"required":["request_id"],"additionalProperties":false}
```

适配器核对 input_schema 中的上述结构；缺少、存在多个匹配项或结构不同均失败关闭。MCP server 的 schema、tools/call、取消和等待结果由根拥有，适配器不实现第二套状态机。

### MCP 配置与前台等待预算

生成配置使用已核对的 stdio 字段：type=stdio、command=当前 Node 的 process.execPath、args=[mcpServerPath]；env 只增加 FLOWER_CONFIRMATION_PROBE_PORT 与 FLOWER_CONFIRMATION_PROBE_NONCE；per-server timeout=300000 毫秒。

Claude 环境同时设置：

- `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`：关闭普通 MCP 调用两分钟后自动后台化；该开关自 2.1.212 已有。
- `MCP_TOOL_TIMEOUT=300000`：工具总时限 300 秒，覆盖本轮至少 260 秒的要求。
- `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=300000`：防止无进度通知的等待提前因 idle 失败。

这些是宿主调用预算，不是业务默认动作计时；业务计时从真实 tools/call 进入根控制器后开始。普通 TUI 使用，未加 bare、print、stream-json、background、resume 或权限/沙箱绕过 flag。[官方 MCP 调用时限](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls)、[自动后台化](https://code.claude.com/docs/en/mcp#automatic-backgrounding-of-long-tool-calls)、[官方环境变量](https://code.claude.com/docs/en/env-vars)。

首响应可以是 text FLOWER_MCP_PLAN 与工具调用的混合内容；SSE 各块按索引发送，最后 stop_reason 为 tool_use。根应记录计划可见时间、tools/call 进入时间及结果续接，不能仅凭服务端请求发出推定完整展示已经完成。

### 安全复用已完成的隔离 startup fixture

本机已存在 `.trellis-tmp/confirmation-timeout-claude-A1Ktoy/config`。只读检查确认该目录的 `.claude.json` 有 hasCompletedOnboarding=true、lastOnboardingVersion=2.1.293，customApiKeyResponses.approved 仅为 dummy，settings.json 仅包含 theme=dark。

适配器在 sandbox/.claude-confirmation-probe/config 中创建新的 CLAUDE_CONFIG_DIR，只挑 onboarding、与当前版本一致的版本提示、dummy 批准和 dark 主题。不复制 projects/trust、userID、machineID、会话 key、sessions、备份、shell snapshots 或任何凭据状态；也不复制整份 fixture。

新 sandbox 的工作区信任仍由根控制器在真实菜单显式处理，不自动写 projects.hasTrustDialogAccepted。若 fixture 不存在，则保持未完成设置的状态，让根处理启动菜单。若专用 .claude.json 已存在，不覆盖根此前处理的实验设置。

沿用此前核对的 `--setting-sources ''`、显式 `--settings`、独立 CLAUDE_CONFIG_DIR、dummy 与 127.0.0.1 Messages mock；白名单继承 PATH、原 HOME、LANG、LC_ALL、TMPDIR，不读取、复制或记录其他认证变量，不改 HOME/home/CODEX_HOME。检测到 Linux 机器级受管配置时拒绝准备，避免未知路由覆盖。[官方配置作用域](https://code.claude.com/docs/en/settings)、[API 与目录环境变量](https://code.claude.com/docs/en/env-vars)。

HTTP_PROXY/HTTPS_PROXY 指向根的回环 mock；根必须像旧探针一样拒绝绝对 URL 代理与 CONNECT，不能转发上游。关闭非必要流量及 prompt history 不等于操作系统级物理断网；网络和子进程生命周期仍归根控制器。

### 文件与代码模式

| 路径 | 证据或用途 |
| --- | --- |
| `research/probes/claude-background-probe.mjs:112` | 旧探针的 Messages SSE 事件顺序，薄适配器复制该已核对模式，不能 import 旧脚本以免触发其顶层 main |
| `research/probes/claude-background-probe.mjs:410` | 旧探针的回环 mock、dummy、独立配置和白名单环境 |
| `research/probes/claude-background-probe.mjs:419` | 本机 --help 已核对的 CLI 参数与普通 TUI 路线 |
| `/root/.nvm/versions/node/v22.23.4/lib/node_modules/@anthropic-ai/claude-code/package.json:3` | 官方已安装版本为 2.1.293；准备阶段读取该元数据，不执行 CLI |
| `.trellis/spec/flower-trellis/cli/module-guidelines.md` | ESM、显式导入、中文公开函数 JSDoc，已沿用 |

父级任务 PRD、constraints-and-harness 与前期研究仍构成需求背景；本轮接入选择以用户最新接受的统一前台入口为准，不再把入口本身列为未决定。

## Caveats / Not Found

- 本轮没有运行适配器准备函数、CLI、MCP 或模型；`node --check` 已通过。纯函数检查覆盖真实工具名和 probe 参数透传、缺少工具/错误 schema 返回 null、混合块 SSE 事件及 tool_use 停止原因、非流式 JSON；不登记真实能力通过。
- `--mcp-config` 可以在未信任的新 sandbox 弹出信任/设置菜单，dontAsk 不负责跳过这些菜单；根必须显式处理。
- 单 MCP 工具进入真实请求、实际名称、权限是否命中、260 秒前台等待、人工取消和退出强杀仍需根的普通 TUI 实验。
- 等待结果约定为 text 内 JSON `{request_id:'probe',source:'policy_timeout'|'cancelled',decision:'continue'|'stop'}`，属于根控制器协议。cancelled 不能作为人工同意；本适配器不改写或伪造该来源。
- SSE 字段按照[官方 Messages 流式格式](https://platform.claude.com/docs/en/build-with-claude/streaming)与已运行旧探针保持一致；工具定义上下文字节数由根统一统计，适配器不另设统计口径。
