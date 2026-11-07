# Research: Codex 0.167.0 MCP 等待工具审批预配置

> 后续实测：主会话已用单次精确工具 approve 完成无本次授权输入的三秒、200秒和取消 / 退出实验，详见 [mcp-wait-results.md](mcp-wait-results.md)。下文“未运行”仅指本篇只读研究阶段。

- Query: 原生 MCP 审批菜单在 `approval_mode="auto"` 下仍出现的证据、精确工具预配置入口，以及 Always allow 的持久化范围。
- Scope: mixed；官方 OpenAI 配置文档 / JSON Schema、本机二进制及本任务 MCP 定义只读核查。
- Date: 2026-11-07
- 约束：本轮不改适配器或控制器、不启动 CLI、不读凭据；只写本文。

## Findings

### 1. 可以准确提出的窄范围配置

官方配置参考明确支持：

```toml
[mcp_servers.flower_confirmation_probe.tools.wait]
approval_mode = "approve"
```

对应单次 CLI 覆盖是：

```text
-c 'mcp_servers.flower_confirmation_probe.tools.wait.approval_mode="approve"'
```

配置键的工具名是服务端原始 `name="wait"`，不是 code-mode 暴露的带 server 前缀调用名。现有内联 serverConfig 也可将 `tools={wait={approval_mode="auto"}}` 改为 `tools={wait={approval_mode="approve"}}`；本轮没有修改。

这只涉及一个 server 的一个工具。保留 `--ask-for-approval on-request` 和 `--sandbox read-only`，不需要设置全局 never 或放宽其他工具。

**证据等级：** 配置键与合法值已被官方参考、官方 JSON Schema 及本机二进制确认；`approve` 为精确工具预批准的含义，由官方插件例子和本机持久允许分支的诊断材料支持。它在本任务完整参数组合中是否消除菜单，仍以主会话的隔离运行结果为准，本研究没有运行测试。

官方出处（均已实际读取）：

- [MCP 配置选项](https://learn.chatgpt.com/docs/extend/mcp#other-configuration-options)：server 默认策略、每工具 override 和支持值。
- [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)：`mcp_servers.<id>.tools.<tool>.approval_mode` 与 `default_tools_approval_mode`。
- [官方 config-schema.json](https://learn.chatgpt.com/docs/config-schema.json)：`definitions/McpServerToolConfig/properties/approval_mode` 引用 `AppToolApproval`；其 enum 为 `auto`、`prompt`、`writes`、`approve`。此次直接从官方域读取 JSON，只输出相应字段，没有保存完整 schema。
- [插件 server 策略例子](https://developers.openai.com/plugins/build/plugins#configure-installed-server-policy)：官方给出默认 prompt，再用精确工具的 `approval_mode="approve"` 覆盖。插件路径与本次普通 MCP 路径不同，不能把插件前缀照抄到普通 server。

### 2. `auto` 为什么不能当作免询问保证

已证实的事实：

1. `auto` 和 `approve` 是同一配置枚举中的**不同值**；官方没有在所读页面将 `auto` 定义为“无条件允许”。不能把 auto 的中文直译当作授权语义。
2. 主会话已观察到 `auto` 仍弹原生 Allow 菜单；这证明该组合未免询问，但不能据此认定整个 per-tool override 机制失效。
3. `research/probes/mcp-wait-server.mjs:8` 的 WAIT_TOOL 只有 name / description / inputSchema，没有 ToolAnnotations，不能据“工具实际上只等待”假定客户端已得到只读声明。
4. 本机已有 MCP Rust SDK `crates/rmcp/src/model/tool.rs:59` 说明 readOnlyHint 的默认语义为 false；`:65` 到 `:73` 说明 destructiveHint 默认 true，`:84` 到 `:91` 说明 openWorldHint 默认 true。这是本地 SDK 协议语义资料，不是 Codex 0.167.0 审批分支的匹配源码。
5. 官方明确 `writes` 对没有标为只读的工具仍要求询问；因此在当前缺少 annotation 的工具上，将 auto 改成 writes 也不能作为可靠免询问方案。

**推断与缺口：** auto 仍服从宿主的自动分类 / 审批逻辑，而不是强制预批准；未找到与该二进制匹配的完整审批实现，不能声称已经还原 auto 的所有分支。仅添加 annotation 也不能代替授权，因为 annotations 是提示而非权限；官方 App Server 文档还提醒 destructive annotation 可以强制触发审批。见[工具审批说明](https://learn.chatgpt.com/docs/app-server#mcp-tool-call-approvals-apps)。

### 3. 本机 0.167.0 的直接诊断材料

版本文件：`/root/.codex/packages/standalone/releases/0.167.0-x86_64-unknown-linux-musl/codex-package.json:3`，版本为 0.167.0。

只读扫描同目录 `bin/codex`：

- 字节偏移 **263525298** 附近包含 `core/src/mcp_tool_call.rs:2440`、`failed to persist MCP tool approval`，紧接配置分支词 `mcp_servers` / `tools` / `approval_mode` / `approve`。
- 同一区域含原生选项文案：只运行本次；`Allow for this session`；`Allow and don't ask me again`；Cancel，并分别描述本次、当前 session、未来工具调用的记忆范围。
- 字节偏移 **263386518** 附近还有 `MCP tool call requires approval, but approval policy is never`。这支持“不应通过 never 来解决此审批”的判断；never 不能被当作该工具的正常授权入口。

这些是二进制内实际存在的诊断文本 / 配置路径线索。它们支持“持久允许最终使用 approve 策略”的推断，**不等于已经取得 ConfigEdit writer 的完整源码或写后文件证据**。

### 4. Always allow 的写盘范围与项目级隔离

**尚未核实 Always allow 菜单的具体写盘层级。** 没有找到该版本匹配源码，所读官方资料也没有保证这个菜单会写当前项目 `.codex/config.toml`。不能因为进程 cwd 位于沙盒，就假定其持久选择只影响沙盒；本轮没有点击或测试该项。

可以确认的替代边界：

- 官方支持**显式项目配置** `.codex/config.toml`，仅 trusted 项目加载；可以在该文件写上第 1 节的精确 MCP 工具配置。该支持不代表原生 Always allow 菜单本身会选择项目文件。
- 官方优先级是 CLI overrides 高于项目配置，高于用户配置。因此本次实验优先用精确工具的单次 `-c ...approval_mode="approve"`，不持久写全局或项目文件。
- 这些 defaults 仍受 managed requirements 约束；不能承诺单次 override 会绕过组织要求。

依据：[Configuration precedence](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)。本研究没有读取用户 config、认证文件或访问当前真实 daemon。

### 5. 如需一次性原生 grant，怎样报告证据

如果精确 approve 在实际隔离运行中仍需授权，可先明确记录一次原生 **Allow**，再验证等待期无需后续输入。报告应分开：

1. 原生工具使用许可发生在等待工具实际进入之前。
2. MCP wait 进入之后才 arm 业务计时。
3. 计时阶段无人再输入，工具返回 policy_timeout / continue 后模型消费结果。

这可以证明“初始工具许可之后，等待期无人输入仍能继续”，不能写成“从启动到结束完全无人工输入”。工具许可也不是用户人工批准业务默认动作；决定来源仍是 policy_timeout。使用 Allow once 不应被替换成未知落盘范围的 Always allow。

### 6. 文件与相关规范

- `research/probes/mcp-wait-server.mjs:8`：本轮只读 WAIT_TOOL，无 annotation。
- `research/probes/codex-mcp-adapter.mjs:70`：主会话正在维护的 serverConfig；本研究只读，未覆盖其改动。
- `/root/.cargo/git/checkouts/rust-sdk-773cd6d57c4837f3/3e636ca/crates/rmcp/src/model/tool.rs:54`：协议注解类型和默认语义；`:48` 明确未受信 server 的 annotation 不应成为信任依据。
- `.trellis/workflow.md:457`：研究结论落盘；任务仍 planning。
- `.trellis/tasks/11-07-confirmation-timeout/prd.md` R2 / R7：授权来源与人工决定 / 策略默认必须分开记录。

## Caveats / Not Found

- 未启动 Codex，未修改根控制器 / 适配器 / server，也未验证 approve 在完整实验中生效。
- auto 的完整审批实现、Always allow 实际写入哪个文件尚无匹配源码或写后证据；不能猜全局 / 项目范围。
- 官方 schema 是本日在线资料；与本机版本的一致部分有本机配置名 / enum / native persistence 诊断线索，但在线 schema 本身不是 0.167.0 的发布锁。
- TextEncoder 在真实 code-mode 中不可用是主会话已发现并修正的事实；本轮不回退适配器修正，也不把纯 Node 环境可用性误当作 code-mode 能力。
