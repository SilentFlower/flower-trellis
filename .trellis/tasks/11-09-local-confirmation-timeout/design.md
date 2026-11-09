# 本项目后台确认演练设计

## Scope

首版在当前 Linux/WSL、Codex 0.167.0 managed daemon 环境中提供主动调用的后台演练。复用项目 Node.js 运行环境，通过原生后台终端运行脚本；不注册 MCP、增加输入 Hook 或修改通用确认门禁。

## Entry And Data Flow

1. 用户明确要求演练，Codex 展示演练内容后，用现有命令工具启动 `node scripts/codex-confirmation.mjs wait --seconds <n> --message <text>`，设置短 `yield_time_ms`，取得后台 session 后结束当前回合，不同步轮询等待结束。
2. worker 从 `CODEX_THREAD_ID` 或显式 `--session` 取得精确目标。连接已有 managed daemon 的控制 socket，核对目标线程和当前项目，订阅同一线程，记录原回合与最新用户消息。
3. 原回合完成后开始倒计时；原回合已完成时直接进入计时。订阅期间的新人工消息使请求失效，正常聊天照常进行。
4. 到期时原子抢占投递资格，通过原生队列发送只携带请求标识的唤醒。读取并保存返回队列 ID，确认目标回合启动或待处理状态；不把进程退出码等同于唤醒成功。
5. 唤醒后的 Codex 先调用 `claim --request <id>`。只有当前会话、请求代次、用户消息基线和消费状态仍有效，才返回一次演练默认文本；无效或重复请求不产生默认动作。

## Files And Ownership

- `scripts/codex-confirmation.mjs`：项目内命令入口，提供 `wait`、`claim`、`cancel`、`status` 和无副作用帮助。
- `src/lib/codex-confirmation.js`：本地状态、短临界区、原子写入、请求转换与 worker 编排。
- `src/lib/codex-queue-client.js`：已有 daemon 的 WebSocket JSON-RPC、同一线程订阅和队列操作；参数以 `research/codex-0.167-queue-schema.json` 与实际生成协议为准。
- `package.json` / `package-lock.json`：显式声明当前已使用的 `ws` 直接依赖，不升级其它依赖。
- `AGENTS.md` 的项目自有部分：明确演练的调用方式、后台启动后结束回合、内部唤醒先领取规则。保留 TRELLIS 受管块。
- `test/js/` 与开发说明：本地状态、竞态、原生 Codex 场景和用户试用步骤。

不改 `vendor/skill-garden`、强化包快照、通用平台 Patch、用户全局 Codex 配置或现有人工确认规则。

## State Contract

状态保存在当前项目 `.trellis/.runtime/codex-confirmation/`，每个 session 一个有界 JSON 记录。临界区按已有 `telemetry-files.js` 的目录锁和同目录原子替换模式实现，但不复用其用户级目录或遥测锁。

记录字段包括协议版本、session ID、当前代次、最近人工消息 ID，以及唯一当前请求：请求 ID、创建代次、演练文本摘要、原回合、状态、截止时间、队列 ID、消费回执和错误原因。新等待替换并失效同一 session 的旧请求；不同 session 不互相取消。

状态主路径为 `prepared → waiting → dispatching → queued → consumed`。用户介入或显式取消进入 `cancelled`；断连、能力不支持、回执未知进入失败状态。已取消或已消费的请求不能恢复为有效等待。

worker 收到用户消息的 started/completed 两种事件时按消息 ID 处理一次。精确匹配当前请求的内部唤醒不是新人工输入，其余提交均使旧请求失效。

## Wake And Idempotency

- 本地锁只包围同步读写，不在锁内联网、等待模型或等待原生队列。
- `dispatching` 转换只有一个 worker 能成功；重复 worker 退出，不再次发送。
- 发送前和收到队列回执后重新核对请求状态。用户介入后撤回仍在队列中的精确 ID，不删除其它消息。
- 原生队列不按 `clientUserMessageId` 去重。重试前先按请求标识读取已有投递；无法判断是否已经投递时记录未知，避免盲目新增第二条。
- 消费端再次核对本地状态和原生最新用户消息。请求只能成功领取一次，旧唤醒即使送达也不能重复输出或执行原默认动作。
- 原生队列与本地记录不共享事务；已经启动的模型回合无法撤回。本轮保证请求不重复有效消费，不承诺竞态窗口里绝无一次过期模型唤醒。

## Failure And Lifecycle

后台程序退出、原生连接断开、目标会话不匹配或协议不可用时停止自动继续，状态与 stderr 提供明确诊断。不会自动启动新 daemon、猜测最新线程或向其它会话补发。

窗口关闭不等同于线程关闭；既有 daemon 和本 worker 的订阅可能继续存活。本轮不保证关窗立即取消，用户可以显式 `cancel`，新消息也会取消旧请求。

本轮演练的默认动作只有返回约定文本。真实 Brief 开工、问题修复和 Push 的自动默认授权均不在范围内。

## Verification

原生 managed daemon 的订阅、队列撤回、重复 ID 行为和唤醒已由研究探针核对。实施中补齐真实后台终端启动、原回合结束后计时、提前回复取消、重复 worker、重复领取、到期竞争、投递失败与断连场景。原生支持范围限当前 Linux/WSL 客户端；其它平台只验证明确的不支持诊断，不推定原生兼容。
