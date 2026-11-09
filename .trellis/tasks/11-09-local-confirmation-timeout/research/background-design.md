# 后台确认的职责与当前证据

## 用户已明确的方向

- 后台计时启动后立即返回，主回合结束；用户继续在当前对话输入。
- 保留自定义时长，不打开网页、窗口，不替换客户端或使用前台启动包装器。
- 重点验证同一会话的唤醒，以及用户输入后旧提醒不再有效、默认动作不重复执行。
- Python 与二进制的差别主要是运行环境和分发，不能把封装形式当成输入控制能力。

## 已读取的当前客户端接口

客户端版本：`codex-cli 0.167.0`。

```text
codex queue --thread <uuid> --message <text> [--resume]
codex app-server proxy [--sock <socket>]
codex app-server generate-json-schema --experimental --out <directory>
```

`codex queue --resume` 帮助明确说明：resume 失败会警告，但命令仍成功。因此不能只以退出码 0 证明会话已被唤醒。

从该版本实际生成的实验协议中读取到：

| 方法 | 已定义参数 |
| --- | --- |
| `thread/queue/add` | `threadId`、`clientUserMessageId`、`input` |
| `thread/queue/list` | `threadId`、可选 `cursor` / `limit` |
| `thread/queue/delete` | `threadId`、`queuedSubmissionId` |
| `thread/queue/start` | `threadId`、可选 `queuedSubmissionId` |

`QueuedSubmission` 包含 `id`、`clientUserMessageId`、`input`。后续真实 managed daemon 实验已经核对：

- 相同 `clientUserMessageId` 连续入队会创建两个不同队列 ID，原生队列不替业务去重。
- 活动回合期间，队列项可以逐条删除，删除后队列为空。
- 空闲会话中 `thread/queue/add` 可直接启动新回合；不能假定总有机会在 `start` 前撤回。
- 已消费的队列 ID 再次传给 `thread/queue/start` 返回 `queued submission not found`，没有多触发一个模型请求。
- `codex queue --resume` 在同一真实 managed daemon 中成功唤醒空闲线程，观察到了目标线程的新模型请求。
- 第二条连接对已有线程执行 `thread/resume` 后，可以收到用户消息的 `item/started` 和 `item/completed` 事件。两种事件具有相同消息 ID，取消逻辑必须按消息 ID 去重。
- 刚创建且从未开始过回合的线程没有 rollout，立即 `thread/resume` 会失败；已有真实对话的线程可订阅。首版须明确拒绝未就绪线程。

完整事件与结果见 `managed-queue-result.json`。测试使用本地模拟模型，不是真实业务执行。

## 既有研究的可复用边界

- 旧会话 `c35eb2ce-5552-423e-9c5d-6c96b01c7d15` 的第 65–74 轮记录了自建 App Server + remote TUI 下，`codex queue` 可以主动续接；当时没有完成 managed daemon 等价路径验证。
- 旧记录还发现窗口关闭后线程短暂保留时仍可能继续，因此不能从 daemon 存活推定用户窗口仍打开。用户此前已讨论放宽关窗即取消；本轮不重建见证代理，仍须精确绑定请求和会话。
- 历史任务的 `background-terminal-probe.md` 只证明后台命令能够返回 session 并被轮询，未证明最终回答后进程完成会自动唤醒原生 Codex。不能依赖未经验证的完成通知。
- 当前项目已存在 `UserPromptSubmit` Hook，位于 `.codex/hooks.json`；新取消行为须保留已有工作流状态与遥测 Hook。

## 拟验证的最小状态契约

1. 每次等待生成唯一请求 ID，关联精确 session ID、项目、待确认内容和截止时间。
2. worker 直接订阅原生用户消息事件使旧请求失效；内部唤醒消息必须与真实用户输入区分，避免自我取消，不增加项目输入 Hook。
3. worker 只能抢占一次投递资格；原生队列消息 ID 回写请求记录，支持读回与撤回。
4. 唤醒只是通知。消费端在默认动作前再次核对请求仍有效、未消费且内容未变；已失效或重复的提醒不执行动作。
5. 本地状态与原生队列不共享事务；必须分别验证投递回执丢失、重试、删除失败及用户输入的竞态，不能预先承诺零重复模型回合。

## 交付边界与实现选择

- 首版复用 Node.js；`ws` 当前已安装为 8.22.1，实施时显式声明直接依赖，不依赖偶然的传递依赖布局。
- Python 直接通过 `codex app-server proxy` 发送 JSON 行未收到响应，见 `managed-stdio-result.json`；不能把该代理当成已经验证的 JSON 行传输。首版使用上述已成功验证的 WebSocket IPC。
- 只修改当前项目的试用脚本、内部模块、依赖声明、测试及 AGENTS 项目说明，不新增 MCP、Hook 或通用平台 Patch。
- 窗口关闭的即时取消不作为本轮保证，不能把额外的观察连接当作原用户窗口仍在线的证据。

## 规范入口

- `.trellis/spec/flower-trellis/cli/quality-guidelines.md`：当前内容下的本地验证、原生跨平台证据与实际客户端测试边界。
- `.trellis/spec/flower-trellis/cli/cli-output.md`：帮助先行、JSON 与诊断输出分离、取消和进程退出行为。
- `.trellis/spec/flower-trellis/cli/trellis-patch-engine.md`：同步交互规则、受管 Hook / 配置的来源与投影边界。
