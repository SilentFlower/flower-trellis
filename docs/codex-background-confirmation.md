# Codex 后台确认演练

本项目提供一个主动试用入口：在当前 Codex 对话内指定等待时间，当前回合结束后由后台终端计时。无人回复时，原生队列唤醒同一会话；任何新人工消息都会使旧等待失效。

目前面向 Linux/WSL、Codex CLI 0.167.0 的 managed daemon。复用本项目 Node 依赖，不需要额外安装、网页、MCP 注册或切换 Codex 启动方式。原生 Windows、其它客户端或版本尚未验证；不支持时会报错，不猜测替代会话。

## 直接在新 Codex 会话中试用

在本项目根目录正常打开 Codex，输入：

> 在当前项目开启 15 秒后台确认演练，到期只输出“15 秒演练完成”。按 AGENTS.md 使用后台终端，启动成功后结束当前回合，不要同步等待倒计时。

观察回合结束后约 15 秒是否自动继续，再试 30 秒。另一次演练启动后，在到期前直接发送“改成 60 秒，输出新的演练文本”。这条人工消息会取消旧等待；Codex 可以按新要求重建等待，无需先按 Esc 取消阻塞工具。

尚未提交的输入框草稿不属于新消息。若唤醒回合已启动，无法撤销那次模型调用；领取检查会阻止旧默认动作再次有效执行。领取成功与稍后提交的新回复属于先后两个事件，不能撤销已经输出的文本。

## 工具调用

由当前 Codex 的原生命令工具调用：

```text
node scripts/codex-confirmation.mjs wait --seconds 15 --message '15 秒演练完成'
```

命令工具使用短 `yield_time_ms`（例如 1000），返回后台 session；确认 JSON 事件 `prepared` 后立即结束当前回合。若尚未收到启动结果，只核对启动阶段的输出，不同步等待完整计时。原回合处于活动状态时不会开始倒计时。中断或失败的原回合不触发到期默认动作。

时间允许 0.1～86400 秒，正文最多 8192 字节。每个会话只保留一条当前请求，新 `wait` 替换旧请求，不同会话相互隔离。

```text
node scripts/codex-confirmation.mjs status
node scripts/codex-confirmation.mjs cancel
node scripts/codex-confirmation.mjs cancel --request <请求 UUID>
node scripts/codex-confirmation.mjs claim --request <请求 UUID>
node scripts/codex-confirmation.mjs --help
```

缺省会话为工具环境中的 `CODEX_THREAD_ID`。也可以显式传入 `--session <线程 UUID>`，两者同时存在时必须相同。线程实际目录必须是本项目根目录。程序不会创建 daemon，也不会向其它线程补投递。

`status` 是离线查询，不联网、不创建缺失状态。`cancel` 先在本地取消，再尽力撤回精确队列项；daemon 不可用时本地取消仍然有效。重复领取返回 `claimed=false`，没有演练正文。已经领取的文本不保证一定被模型成功展示；为避免重复输出，不自动重放领取回执。

## 状态与边界

状态位于 gitignored 的 `.trellis/.runtime/codex-confirmation/<会话 UUID>.json`，每个文件大小有界。`prepared` 表示已准备、等待原回合结束；`waiting` 表示倒计时；`dispatching` 表示唯一 worker 正在投递；`queued` 仅表示拿到原生队列回执，`wakeTurnId` 非空才表示观察到了唤醒回合。`consumed` 表示一次有效领取；`cancelled`、`failed`、`delivery_unknown` 均不得输出默认文本。

原生队列不会按同一个消息 ID 去重，因此本地目录锁控制投递，消费者再次核对请求代次和最新人工消息，再原子领取一次。队列可能在回执落盘前启动回合；回执丢失时记录 `delivery_unknown`，不会盲目补发。后台连接断开会失败；提醒排队后 5 分钟仍无人领取也会失败并尝试撤回。

本地状态和原生队列不共享事务，无法保证竞态中没有额外的过期模型回合，但旧提醒不能重复有效领取。窗口关闭不一定意味着 daemon 的线程关闭，因此不保证关窗立即取消；需要时显式 `cancel`。终止自有后台终端会取消等待，强制杀进程可能留下未完成记录，重新 `wait` 或 `cancel` 可使其失效。

本轮默认动作仅为演练文本。Brief、Check、Push 等真实业务流程仍使用人工确认，演练时间流逝不构成新的权限或 Git 操作授权。

## 本地验证

```text
node --test test/js/codex-confirmation.test.js test/js/codex-queue-client.test.js
```

通用状态、并发与入口诊断加入 Ubuntu/Windows 的 CI 测试清单。真实 managed daemon 场景使用隔离的 `CODEX_HOME` 和本地模型替身，结果记录在当前任务的 `research/`；这类证据与用户新会话实际观察分别记录，不推定未测试平台兼容。
