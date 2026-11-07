# Research: Codex 默认 daemon 的隔离入口与配置覆盖回退

- Query: 不改变 HOME / CODEX_HOME、不连接现有 daemon 的条件下，能否创建专用默认 daemon 实例；单次 `-c` 是否使 TUI 回退前台。
- Scope: mixed；本机 0.167.0 帮助、二进制只读材料及官方 OpenAI 文档。
- Date: 2026-11-07
- 本轮只执行 `--help` 与只读检索，没有启动、连接、停止、重启 daemon，也没有运行或修改探针。

## Findings

### 1. 准确的现有接口

| 已执行的只读命令 | 帮助中实际提供的能力 |
| --- | --- |
| `codex app-server daemon --help` | bootstrap / start / restart / update / enable-remote-control / disable-remote-control / stop / version。顶层只有通用 `-c`、`--enable`、`--disable`。 |
| `codex app-server daemon start --help` | 通用配置覆盖；没有专用 socket、instance、name、pid-file 或独立 runtime-root 参数。 |
| `codex app-server daemon restart --help` | 同上，没有指定隔离实例的入口。 |
| `codex app-server daemon stop --help` | 同上，没有指定隔离实例的入口。 |
| `codex app-server daemon bootstrap --help` | 额外只有 `--remote-control`；没有命名实例 / 专用 socket。 |
| `codex app-server proxy --help` | **`--sock <SOCKET_PATH>`**：连接已经运行的 App Server Unix socket，进行 stdio 字节代理。它不是创建 daemon 实例的参数。 |
| `codex app-server --help` | **`--listen <URL>`** 支持 `stdio://`、`unix://`、`unix://PATH`、`ws://IP:PORT`、`off`；可给普通 App Server 指定专用 socket。 |
| `codex remote-control --help` | 管理默认 daemon 的 start / stop / pair；裸命令的 `--no-daemon` 是前台 embedded App Server，不提供命名 daemon。 |

因此：在已经读取的现有接口和文档中，**没有找到可以不改 CODEX_HOME 就为 `app-server daemon start` 指定第二个独立 managed daemon 实例的参数**。不能猜测 `--instance`、`--socket`、`CODEX_DAEMON_SOCKET` 等接口。`proxy --sock` 不能补成实例创建能力。

### 2. 确实存在的独立 server 对照

官方支持普通 App Server 监听专用 Unix socket，再由原生 TUI 显式连接。仅作为未来实验的接口示意，**本轮没有运行**：

```text
codex app-server --listen unix://<独立沙盒绝对路径>/probe.sock -c <全部本地 mock/provider 配置>
codex --remote unix://<同一独立沙盒绝对路径>/probe.sock <本次探针初始提示>
```

- mock provider、dummy、sqlite_home / log_dir 等 server 配置应落在独立 server 的本次启动参数，不能期望 client 的 provider override 自动改变已经运行的 server。
- `--remote` 支持 `ws://`、`wss://`、`unix://`、`unix://PATH`。
- `--remote` **不能与 `--no-daemon` 组合**；官方 global-flags 明确规定该边界。
- 这是“独立 server + remote TUI”对照，**不是默认 managed daemon 的自动发现 / 自动启动路径验收**。
- 专用 socket 隔离连接目标，不隔离整个 CODEX_HOME 的认证、session、plugin 等状态；这些仍要沿用前序实验的明确边界。

官方出处均已实际获取：[App Server：Connect the CLI terminal UI](https://learn.chatgpt.com/docs/app-server#connect-the-cli-terminal-ui)、[Protocol](https://learn.chatgpt.com/docs/app-server#protocol)、[Global flags](https://learn.chatgpt.com/docs/developer-commands#global-flags)。

### 3. `-c` 与 daemon fallback 的证据等级

本机已安装二进制：`/root/.codex/packages/standalone/releases/0.167.0-x86_64-unknown-linux-musl/bin/codex`；版本文件 `codex-package.json:3` 为 `0.167.0`。

只读扫描同版本二进制，在字节偏移 **261494308**、**267006460** 附近找到明确诊断文本：

```text
command-line configuration overrides (-c, --enable, --disable, or --search)
```

相邻诊断符号含 `daemon_compatibility`、`config_override`、`custom_config_loader`、`strict_config`、`codex.tui.embedded_start`；另有 `daemon_selection_reason` 及 `incompatible_option` / `explicit_no_daemon` / `existing_daemon` / `auto_start` 等分类。

**推断：** 这强烈支持单次命令行 config overrides 属于 daemon 不兼容条件，会令本地 TUI 选择 embedded / 前台路径。当前探针含大量 `-c`，所以仅去掉显式 `--no-daemon`，不能据此宣称已验证默认共享 daemon。

**尚未证实的部分：** 没有与本机二进制匹配的完整 TUI 源码，也未在本轮启动进程取得选择 trace。二进制诊断字符串不能单独证明全部例外、配置值是否逐项判断、`--remote` 显式连接的优先级，或每个参数组合的最终选择。官方所读页面也没有给出 `-c → fallback` 的完整条件表，故这里不把推断写成已实测事实。

未来若要验证默认原启动方式，需记录实际的 daemon selection / app_server_mode 证据，不能只按 argv 是否含 `--no-daemon` 分类。本轮不读取或连接当前真实 daemon 来取得该信息。

### 4. 文件、模式与相关规范

- `.trellis/tasks/11-07-confirmation-timeout/prd.md` R12 / AC12：原生后台优先，保持证据分层；独立 server 对照不能改名为默认 daemon 已通过。
- `.trellis/workflow.md:457`：Phase 1.2 研究结论落盘。
- `/root/.codex/packages/standalone/releases/0.167.0-x86_64-unknown-linux-musl/codex-package.json:3`：精确本机版本。
- [OpenAI Docs：管理后台 server](https://learn.chatgpt.com/docs/developer-commands#manage-the-background-server-with-daemon) 明确 `/daemon` 更新 / 重启可能中断其他 chat。本轮只读帮助，未调用其任何管理动作。

## Caveats / Not Found

- 没找到默认 managed daemon 的专用实例 / socket 参数；不从未公开的环境变量、内部结构或通用 `-c` 推造此能力。
- `-c` 回退前台目前是本机二进制诊断的强推断，缺匹配源码或运行选择记录。
- 可以准确提出独立 `app-server --listen unix://PATH` + `codex --remote` 对照；它不能等同默认共享 daemon，也不能继承此前 no-daemon 实验结论。
- 本轮没有重查后台自动续接结论，没有改动现有探针或其他协作者文件。
