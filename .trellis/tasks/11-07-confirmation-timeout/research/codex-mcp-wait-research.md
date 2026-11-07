# Research: Codex 标准 MCP 等待薄适配器

- Query: 在已获准的统一前台入口隔离实验中，为 Codex 0.167.0 注册唯一 stdio MCP wait，并用本机 Responses mock 驱动一次等待与结果消费。
- Scope: mixed；已有真实探针载体、已保存的工具定义、官方 MCP 配置。
- Date: 2026-11-07
- 状态：仍为 planning。本轮只制作研究适配器，没有启动 CLI、server、MCP 或模型 API，也不改产品代码。

## Findings

### 导出合同

文件：`research/probes/codex-mcp-adapter.mjs`。

- `prepareCodex({sandbox,mockPort,controlPort,nonce,mcpServerPath,requestId})`：同步返回 `{executable,args,env,version}`。sandbox 必须是根已创建并 git init 的绝对路径；MCP 脚本必须存在；requestId 固定 `probe`。函数只读安装元数据，不运行 CLI 或写配置。
- `handleCodexRequest(body,state)`：每个实验传新建 `{}`；返回 `{events,auxiliary,phase,toolSummary,summary,retry}`。根控制器负责 HTTP、鉴权、计时、进程和清理，不能把整个 body 落盘。
- `buildCodexResponseEvents({sequence,text,toolCall,planText})`：构造已有真实探针验证过的 Responses 事件。text 与 toolCall 二选一。首次响应先输出 `FLOWER_MCP_PLAN` commentary，再在同一响应调用等待工具。
- `encodeCodexSse(events)`：编码成 SSE 字符串；根设置 `content-type: text/event-stream` 后发送。
- 常量 `CODEX_PROBE_DUMMY`、`CODEX_MCP_SERVER`、`CODEX_MCP_CALL_ID` 用于根控制器鉴权、关联与日志白名单；不能把 nonce 或 env 全量输出。

`state` 只在本次实验内持有：sequence、mainThreadId、phase、toolSummary、replies（哈希 → 自己构造的响应）。它不保存原始请求或 headers，不应跨进程、nonce 或重新打开的会话复用。重复输入返回原已构造响应并标 retry，不发第二次逻辑等待；根仍须核对 MCP 服务端实际调用计数，不能仅凭 mock 重放保证工具端幂等。

### 一次性 MCP 注册

单次 `-c` 注册 `mcp_servers.flower_confirmation_probe`：

```text
command = <process.execPath>
args = [<mcpServerPath>]
env = {
  FLOWER_CONFIRMATION_PROBE_PORT = <controlPort 的字符串>,
  FLOWER_CONFIRMATION_PROBE_NONCE = <nonce>
}
enabled = true
enabled_tools = ["wait"]
startup_timeout_sec = 10
tool_timeout_sec = 260
```

根提供的 Node stdio server 只声明 `wait`，schema 为对象、唯一必填 `request_id: string`、禁止额外字段。调用只传 `{request_id:"probe"}`。server 必须保持 stdout 纯 MCP 协议，安全诊断应走 stderr 或根控制通道。

`mcp_servers={}` 已证实不会清除既有配置，因此适配器分别设置 `mcp_servers.mysql.enabled=false`、`mcp_servers.openaiDeveloperDocs.enabled=false`，并加入本次 server。它不读取用户配置来发现其他 server；若环境另有已启用 server，根须先明确并扩大禁用名单，不能假定本适配器已经关闭未知插件。

准确字段来自已实际获取的[OpenAI Docs：STDIO servers](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)与[Other configuration options](https://learn.chatgpt.com/docs/extend/mcp#other-configuration-options)。默认 tool timeout 是 60 秒，本次显式设 260；该预算是运行时上限，不是业务默认决定。

### 实际工具路径与尺寸记录

1. 从 `body.tools` 及 `body.input[].type === "additional_tools"` 的 tools 合并实际工具，不修改原 body。
2. 如果真实广告直接包含本 server 的 wait，则核对 request_id schema 后调用；toolSummary 保存实际定义 JSON 字节数、description 字节数和名字，不保存定义正文。
3. 否则只接受已验证的 `functions.exec` custom / lark 入口，且实际 description 必须声明 ALL_TOOLS。代码在运行时筛选宿主真实 ALL_TOOLS 中属于 `flower_confirmation_probe` 的 wait，要求唯一，然后用 `tools[selected.name]` 调用。没有构造或猜测一个惯用工具名来执行。
4. code-mode 输出只打印 `FLOWER_MCP_TOOL_META` 的实际 name / metadata_bytes / description_bytes，以及本次 wait 的有限结果。definition metadata 取自实际 `{name,description}`，不是把它冒充 MCP tools/list 原始 manifest 尺寸；根可另行记录自己发出的 manifest 字节数。

已有只读基线：`.trellis-tmp/confirmation-timeout-codex-TMVJsi/exec-tool-schema.json` 保存了本机真实 exec 定义；custom / grammar / lark，description 明确含 ALL_TOOLS。以紧凑 JSON UTF-8 计算该 wrapper 为 14697 字节、description 为 14027 字节。这是旧后台探针的 wrapper 尺寸，**不是尚未执行的新 MCP wait 尺寸**。

### 安全结果与标记

根约定 MCP text 为 JSON：`{request_id:"probe",source:"policy_timeout"|"cancelled",decision:"continue"|"stop"}`。

- 只有 `policy_timeout + continue` → `FLOWER_MCP_CONTINUED`。
- 只有 `cancelled + stop` → `FLOWER_MCP_CANCELLED`。
- 其他错误 / 未识别结构 → `FLOWER_MCP_UNVERIFIED`，不宣称已决定。
- code-mode 提前 yield 的 `Script running with cell ID` → `FLOWER_MCP_PENDING`，明确未完成，不能解释为 MCP 中断或默认继续。

人工输入由根控制器先撤销旧事项，wait 返回 cancelled，不伪装为人工同意。计时仅由 MCP 实际进入之后开始；根还要观察 PLAN 在 PTY 可见与 wait 进入先后，本模块不人为模拟时序通过。

辅助 `thread_title` 和其他 thread 的请求返回 `FLOWER_AUXILIARY`，不推进主状态。请求无工具且主状态未建立时也按辅助处理，复用旧探针已排障验证的分流方式。HTTP 第几次请求本身不是继续证据，必须有匹配 call_id 的工具结果与正确 source / decision。

### 启动与退出边界

- 使用原探针已跑通的 `--no-daemon --no-alt-screen --sandbox read-only --ask-for-approval on-request`，不附着真实 daemon。
- mock provider 唯一、base_url 只指本机回环、requires_openai_auth=false、独立 dummy、supports_websockets=false；gpt-6.1-sol 只用作已验证的本地工具元数据选择，不调用真实模型。
- 保留原 HOME / home / CODEX_HOME / CODEX_SQLITE_HOME；不读凭证，不编辑用户全局配置。原生 CLI 内部认证读取、标准 rollout 与共享状态写入仍是已知运行边界，不能由本模块宣称隔离。
- 不再加入旧探针已确认有问题的 strict-config / disable_response_storage / sqlite_home override；保留 api_key_model_discovery=false、shell_snapshot=false、prevent_idle_sleep=false 等已验证参数。
- 父级 PTY 必须复用真实查询应答：`ESC[6n → ESC[1;1R`；收到 `ESC[c` / `ESC[0c` 时回 `ESC[?1;2c`。本模块不拥有 PTY，因此不会自行写终端输入。
- stdout/proxy/生命周期清理由根控制器负责；环境 proxy 只是抑制外连的软边界，不能称为 OS 网络隔离。

### 相关文件与规范

- `research/probes/codex-background-probe.mjs:137` 附近：已验证 code-mode custom call；`:321` 附近：辅助 metadata / additional_tools；`:440` 附近：已验证单次参数；`:499` 附近：DA1/DSR 处理。行号随主会话后续编辑可能变化，本轮不改该文件。
- `.trellis/workflow.md:457`：Phase 1.2 研究落盘。
- `.trellis/spec/flower-trellis/cli/module-guidelines.md`：ESM、显式导入、中文 JSDoc；此研究脚本不是产品模块。
- `.trellis/tasks/11-07-confirmation-timeout/prd.md`：当前授权是隔离研究实验，不是产品实施。

### 本轮验证

- `node --check research/probes/codex-mcp-adapter.mjs` 通过。
- 在纯内存中读取已有真实 exec schema 作为夹具，核对了 additional_tools 提取、PLAN 在工具之前、custom_tool_call 形状、SSE 编码、相同输入重试、policy_timeout / cancelled 分流和 code-mode pending 分类，全部通过。没有执行生成的工具代码，也没有启动 Codex 或调用 API。
- `prepareCodex()` 的 args 最后一项已经包含初始中文 prompt，根 factory 不应再次追加。

## Caveats / Not Found

- 尚未执行新 MCP 实验；配置及载体复用已有证据，实际 MCP 启动、readonly 审批行为、延迟元数据、取消和退出必须由根控制器实测。
- 当前适配器只处理短实验；长等待的 functions.exec yield / wait-cell 由根后续研究，当前 pending 标记只表示证据未完成，不作生命周期结论。
- 本模块没有 server、控制器、计时器、信号处理或任何业务动作；准备参数不是启动，SSE 模拟也不等于已经验收用户交互。
