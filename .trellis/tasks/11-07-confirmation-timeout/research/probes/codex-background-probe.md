# Codex 原生后台终端隔离探针

- 日期：2026-11-07。
- 用途：只验证真实 Codex 0.167.0 TUI 在最终回答后，后台计时进程完成是否能无人输入续接。
- 状态：已运行真实 TUI、exec 和独立 App Server 对照。两次 `--no-daemon` TUI 的后台任务先返回并结束，但最终等待后8秒 / 15秒均未观察到原生续接；独立 App Server 对照观察15秒同样未续接。见 [实际结果](../native-background-results.md)。
- 用户已选原生后台终端优先；本脚本的 `--no-daemon` 仅隔离实验进程，不是产品启动要求。

## 审查后如何运行

```bash
node --check .trellis/tasks/11-07-confirmation-timeout/research/probes/codex-background-probe.mjs
node .trellis/tasks/11-07-confirmation-timeout/research/probes/codex-background-probe.mjs --run
```

默认等最终 `FLOWER_WAITING` 在 PTY 输出后观察 8 秒，总预算约 40 秒。也可 `--yield-ms 1000`；默认 250。脚本要求 Linux 及本机 `codex-cli 0.167.0`，使用现有 node-pty，不安装依赖。

`--mode tui` 为 `--no-daemon`；`--mode exec` 只作传输 / 工具对照；`--mode server-tui` 创建专用 Unix socket 的独立 App Server 并通过原生 `--remote` 连接，只作服务与前端分离的对照，不等价默认 managed daemon。不会附着或停止当前共享 daemon。

脚本先在 `.trellis-tmp/confirmation-timeout-codex-*` 新建独立沙盒，然后只监听 `127.0.0.1` 随机端口。不发 queue/resume 或已有线程消息。首次请求读取实际 tools schema，包括真实请求 `additional_tools` 中的声明。本机提供 `functions.exec` 自定义代码工具，其声明明确列出 `tools.exec_command`；探针按该声明调用原生终端。直接 function 形式的 exec_command 也必须通过实际参数校验。没有已核查入口会报告未定。

计时工具只运行：

```text
python3 -I -S -B -c 'import time; time.sleep(3); print("FLOWER_TIMER_DONE", flush=True)'
```

第二次有效请求必须已经包含此调用的后台 session 工具结果，并且尚无完成标记，mock 才返回最终 `FLOWER_WAITING`。以后收到的请求只有在 PTY 已输出最终标记、且新增模型输入或工具结果确有 `FLOWER_TIMER_DONE` 时，才回应 `FLOWER_RESUMED` 并记作合格。相同输入重试单独记录；HTTP 请求序号本身不算唤醒证据。

初始任务之后没有额外用户消息，没有 write_stdin / TaskOutput 调用；只应答 PTY 实际发出的 `ESC[6n` 位置查询和 `ESC[c` 普通设备属性查询。后台 Python 的出现和退出通过自己拥有的 Linux 进程树旁观，旁观结果不输入 Codex。观察期保持原生 TUI 开着。自动标题生成按真实 thread/source 元数据排除，不能混算主请求。

## 配置与外连边界

- 单次 `-c` 配置唯一自定义 provider、`wire_api="responses"`、`base_url="http://127.0.0.1:<port>/v1"`、`requires_openai_auth=false`、`supports_websockets=false`。只传 `FLOWER_TIMEOUT_PROBE_TOKEN` dummy，不复制真实认证环境变量，也不读取认证文件。mock 只接受指定 dummy，永不落盘 headers。
- 保留原 `HOME`、`home`、`CODEX_HOME`、`CODEX_SQLITE_HOME` 值；不编辑用户全局配置。`log_dir` 指到沙盒，hooks/apps/plugins/memories/web search/MCP 和更新检查按单次配置关闭。TUI 对本机已存在的两个 MCP 另做单次 enabled=false 覆盖；exec 使用 --ignore-user-config。当前未使用 --strict-config，因为本机已有旧字段会使 CLI 拒绝启动。
- 使用 `read-only` sandbox 和 `on-request` 审批；没有 sandbox / hook trust 绕过 flag。沙盒是本次新建空目录，只有它通过单次 project trust 配置设为 trusted。
- 子环境把 HTTP(S)/ALL proxy 指向只会拒绝外连的本机服务，NO_PROXY 仅放行回环。**这是尽力抑制非探针流量，不是操作系统级网络隔离**；忽略 proxy 的本机组件仍需在审查中评估。模型请求只允许 mock，没有真正的模型推理。
- 脚本自身不读或记录用户凭证，但原生 Codex 的启动内部是否仍会打开既有认证状态，不能仅凭 provider 配置保证。若要求操作系统层面阻断凭证文件读取，需要额外隔离设计，不能默认为已完成。
- 不改变 CODEX_HOME 意味着原生 CLI 仍可能保留标准 session/rollout 等状态；log_dir 不等于整个 Codex home 隔离。曾尝试使用空 SQLite 目录，触发全量旧会话索引并阻塞请求，已移除该覆盖；当前沿用既有索引。未使用 disable_response_storage。脚本仅保存字段 / 工具结构、固定计时工具结果与时序摘要，不保存原始请求、完整 PTY、prompt 或 headers；CLI 自身的状态与研究摘要须分开看待。
- 通过 Linux PID + 启动时间身份，仅清理自己拥有的 TUI 及已观察后代；不使用 pkill、不杀当前 daemon。退出先 TERM，700ms 后只对同身份存活进程 KILL，最后关闭 mock socket/server。

## 输出与证据限制

沙盒中 `events.jsonl` 是请求序号、相对时间、工具名、标记和后台状态摘要；`result.json` 是时序与判据结果。没有原始错误堆栈，避免配置或认证信息被异常文本带出。原生诊断日志在 `native-logs`；脚本不读取或拷贝这些日志。

`exec-tool-schema.json` 只保留实际广告的 exec 工具定义，用于核对自定义工具协议；不包含请求正文。custom_tool_call / input delta / done 的字段按官方 OpenAI SDK 类型定义核查；不能将其伪装为 JSON function_call。

成功必须同时出现：后台 session 先返回、PTY 输出最终等待标记、无人输入、后续请求新增完成标记、PTY 输出继续标记。后台完成却无这些后续证据，报告“未观察到”，不推导所有版本 / daemon 模式都不支持。

最小脚本不会处理信任菜单、登录菜单或协议之外的交互；这类阻塞在总超时后为未定，不能冒充 idle 续接失败。`FLOWER_WAITING` 的原生最终消息与 HTTP `response.completed` 是当前可观察结束边界；本脚本没有 App Server `turn/completed` 旁路订阅，严格 wire turn ID 仍未知。退出取消 / 人工抢占 / 手动重开属于后续实验，当前不宣称通过。

## 已核查依据

- 本机 `codex --help`：`--no-daemon`、`--no-alt-screen`、`--strict-config`、`--sandbox`、`--ask-for-approval`、`--cd`、`-c` 和初始 prompt 均存在；版本输出为 0.167.0。
- [OpenAI Docs：自定义 provider](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers)与[Responses provider 配置](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server#using-codex-app-server)：本机 provider 参数与关闭 OpenAI auth / websocket 的准确字段。
- [OpenAI Docs：function calling streaming](https://developers.openai.com/api/docs/guides/function-calling#streaming)：`output_item.added`、函数参数 delta/done、`output_item.done`；[Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses)：created / text delta / completed。
- [OpenAI Docs：sqlite home](https://learn.chatgpt.com/docs/config-file/environment-variables#core-locations)、[log_dir](https://learn.chatgpt.com/docs/environments/network-file-systems#move-diagnostic-logs-to-local-disk)、[关闭 hooks](https://learn.chatgpt.com/docs/hooks#turn-hooks-off)。
- 本机 `/root/project/xiaoxian-desktop/packages/subagent/subagent-codex/tests/responses-fixture.ts:95` 有已用于旧版 Codex 的 SSE 生命周期样例；只借鉴消息字段，不把旧版测试当作本机运行证据。`node_modules/node-pty/typings/node-pty.d.ts:18` 和仓库 `src/lib/trellis-runner.js:183` 核对 spawn / PTY 数据 / 退出接口。
