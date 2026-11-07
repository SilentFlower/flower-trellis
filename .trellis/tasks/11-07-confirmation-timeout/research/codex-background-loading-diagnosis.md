# Research: Codex 原生 TUI loading 且 mock 零请求的只读排障

- Query: 0.167.0 原生 TUI 只显示 loading / Ask Codex 时，初始 prompt、终端查询和 exec 对照能提供什么证据。
- Scope: mixed；已有探针产物、本机库源码、官方 OpenAI 文档。
- Date: 2026-11-07
- 约束：不改正在由主会话维护的探针、不运行 CLI、不触碰当前线程或 daemon。

## Findings

### 观察到的事实

- `.trellis-tmp/confirmation-timeout-codex-NqRHrw/result.json`：主请求、辅助请求、重试均为 0；没有最终等待标记、继续标记或计时进程证据，结果为总超时。该次不能用于评价后台完成是否自动续接。
- 同目录 `events.jsonl`：8ms 启动；135ms 已应答终端位置查询；37512ms 达总超时；37668ms 记录子 TUI 退出。启动诊断只统计到 loading / Ask Codex，没有 error、auth、trust、warning 等类别命中，未输出完整诊断或 prompt。
- `native-logs/logs_2.sqlite` 通过 `mode=ro` 读取：`logs` 表 0 行。当前脚本设置 `RUST_LOG=off`，日志文件存在不代表含有可用的启动诊断。
- 当前探针把初始 prompt 放在 CLI argv 最后，未在 PTY 主动输入用户消息。本机已核查的 `codex --help` 把位置参数描述为启动会话用的可选 prompt；本轮没有找到“必须额外 Enter 才提交”的官方合同，也没有对应 Codex TUI 完整源码可证实内部调度。

### 最小排障顺序

1. **先做传输对照**：在后续获授权的运行里，以同一 loopback mock、唯一 provider、dummy env_key 和全部本地 provider overrides，运行 `codex exec --ignore-user-config --json --ephemeral --sandbox read-only` 单轮。只判断 API 请求与 JSON 生命周期是否到达；这样可把 TUI 启动、终端能力与 provider / SSE 链路分开。该对照不能替代原生 TUI 最终回答后的 idle 验收。
2. **只应答实际发出的终端查询**：当前只处理 `ESC[6n`。本机 crossterm 源码还会发 `ESC[?u` 与 `ESC[c`。可先对实际收到的 primary DA 查询应答普通终端 `ESC[?1;2c`，保留 DSR，不假装支持 kitty。不要只回 kitty flags 而遗漏 DA。
3. **启动交互单独分组**：若要额外发送 Enter 诊断位置参数是否仍在待提交状态，应记作一次不同的启动控制实验，不能悄悄并入无人输入基线。当前 loading 现象不足以证明初始 prompt 需要 Enter。
4. **需要原生日志时缩窄级别和目标**：当前 off 导致零行。主会话可在后续运行设置有界诊断级别，再只提取目标、级别、文件行与类别，避免保存 / 回显完整 prompt 或 headers。本研究没有修改日志配置。

### 终端查询的准确本地证据

本地文件根：`/root/.cargo/git/checkouts/crossterm-ce0318b92aca4e8d/ed1cdab/`。这是本机已有库源码，未证明与 Codex 0.167.0 的确切依赖锁一致。

- `src/terminal/sys/unix.rs:231`：写出 `ESC[?u` 紧接 `ESC[c`。
- `src/terminal/sys/unix.rs:247`：等待 keyboard / DA 响应的 poll 通常以 2000ms 为界。因此完全不回这组查询通常只能解释短暂启动延迟，不能单凭此归因约 37 秒的 loading。
- `src/terminal/sys/unix.rs:255`：如果先收到 keyboard flags，接下来会用 `internal::read(PrimaryDeviceAttributesFilter)` 排空 DA；不能只模拟 flags 却不提供 DA。
- `src/event/sys/unix/parse.rs:345`：primary DA 解析识别以 `ESC[?` 开头、`c` 结尾的回应，并产生内部 PrimaryDeviceAttributes 事件。`ESC[?1;2c` 属于该解析形状。
- `src/style/query.rs:42`：颜色槽查询也会等待，poll 为 2000ms；`:71` 构造 OSC `10` / `11` 等槽的查询形状。没有实际收到相应查询的记录前，不把颜色当根因。

探针的控制缓冲区目前先截为最后 512 字节再找查询；若查询恰在一个大 chunk 的开头，有可能被截去。它是可检查的处理边界，但 NqRHrw 在 135ms 已有 DSR 应答，不能以这个可能性解释该次 DSR 完全失效。

### 官方资料与证据等级

- [OpenAI Docs：Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) 已实际获取：`exec --ignore-user-config` 跳过用户 config，`--ephemeral` 避免保留 session rollout，`--json` 提供 thread / turn / item 生命周期事件。该页没有说忽略用户 config 同时禁止认证状态、managed 或项目配置读取。
- [OpenAI Docs：Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) 已实际获取：交互 TUI 与 exec 是不同入口，单次 `-c` 覆盖只作用于该 invocation。网页内动态 flags 表未提供足以证明初始 prompt 内部提交顺序的源码。
- [OpenAI Docs：Codex CLI](https://learn.chatgpt.com/docs/codex/cli) 已实际获取：描述正常交互启动与任务输入，没有可直接定位本次 loading 的终端查询合同。

### 文件与相关规范

- `research/probes/codex-background-probe.mjs`：本次只读查看主会话最新修改；不覆盖其改动。
- `.trellis/workflow.md:457`：Phase 1.2 研究与证据落盘。
- `.trellis/tasks/11-07-confirmation-timeout/prd.md` R12 / AC12：原生后台优先，传输 / 工具返回 / 主回合结束 / 完成通知分别记录；未通过不得以启动器绕过。

## Caveats / Not Found

- 本轮没有运行任何 Codex 命令，也没有修改探针、配置、sandbox 或正在运行的进程。
- 初始 prompt 自动提交的准确内部时机仍无与本机二进制匹配的源码证据；只能说 CLI 的位置参数合同面向启动任务，没有发现要求补 Enter。
- 本机库源码证明额外 terminal query 存在及其等待方式，不能证明当前 loading 的根因就在这里。
- exec 链路若通过，仍须回到 TUI；它不会证明后台完成可在原生 TUI idle 状态无人输入续接。
