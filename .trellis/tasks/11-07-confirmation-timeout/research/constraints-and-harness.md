# 确认超时的现有约束与 Harness 接入证据

记录日期：2026-11-07。本文记录已核实的现状与技术缺口，不把讨论中的建议当作用户已作出的产品决定。

## 当前状态与所有权

- 本任务状态为 `planning`，尚未运行 `task.py start`，尚未编写产品代码。
- `.flower/plugins.json` 与 `.flower/plugin-lock.json` 声明并锁定 `flower/skill-garden`。其拥有的 workflow、Skill、hook 与脚本属于部署结果。
- `.agents/skills/trellis-meta/SKILL.md` 与其 `references/customize-local/overview.md` 规定：0.6 持久化作者源在 `vendor/skill-garden/.trellis/0.6/`，发布快照在 `enhancements/0.6/`，通过同步、编译产物校验和 Flower 生命周期更新 dogfood；不能只修改部署副本或 `node_modules`。

## 已核实的流程合同

- `.agents/skills/trellis-task-brief/SKILL.md`：首次实施前完整展示 Brief，默认等待确认；当前任务最终 Brief 的明确预授权仅在原范围内生效。现有规则不建立跨会话永久预授权。
- `.agents/skills/trellis-check-all/references/reporting-and-disposition.md`：没有未处置问题且未要求停止时，检查通过自动进入 Spec 与 Push 计划；有问题时由用户选择修复范围或接受风险。
- `.agents/skills/trellis-update-spec/SKILL.md` 的 `Autonomous Spec Evaluation`：自主产生 `no-op` / `written` / `needs-review`；只有无法唯一确定的目标规范、业务语义、冲突或验证失败才进入 `needs-review`，不是日常固定确认。
- `.agents/skills/trellis-push/SKILL.md` Step 3 / Step 4：精确计划确认前不得暂存、提交或推送；执行前重新核对计划与 Git 基线。
- 当前同步 `request_user_input` 工具的已提供 schema 没有超时参数。不能仅增加 Skill 文案就声称现有提问工具具备限时返回或退出取消。

## 本地运行入口

- `.codex/hooks.json` 当前登记 `UserPromptSubmit`、`SubagentStart`、`SessionStart`，没有会话退出清理入口。现有注入 hook 不能独立证明窗口存活或到点唤醒。
- `.trellis/scripts/auto_loop.py` 的 `cmd_next()` 按命令调用计算并返回下一动作；当前没有持续计时或恢复主会话的计时循环。
- `.trellis/scripts/decision_log.py` 的 `append_decision()` 为 auto-loop 的 AI 自主决策记录，要求 `run_id`、候选选项、已选项及证据等；不是可直接复用的交互确认计时协议。
- `src/lib/trellis-runner.js` 负责运行 Trellis CLI 与 PTY 交互，并非现有的通用 Harness 会话控制器。
- 仓库已有 `.codex/`、`.claude/` 平台入口；平台映射和分发规则不等于超时功能已具备相应运行能力。

## 官方接口证据

### Codex

- [OpenAI Docs：codex queue](https://learn.chatgpt.com/docs/developer-commands#codex-queue)：可向已有会话排队文本，`--resume` 会尝试恢复会话，依赖本地 daemon 或指定 server。恢复失败可能只输出警告，命令仍成功退出。本机 `codex queue --help` 与该语义一致。
- [OpenAI Docs：回合生命周期](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)：App Server 可启动或恢复 thread，使用 `turn/start` 发起回合，并发出 `turn/completed`。
- [OpenAI Docs：取消 thread 订阅](https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread)：最后订阅者离开后，空闲 thread 默认延迟 60 秒卸载。因此 `thread 已加载` 或 server PID 存活不能替代当前用户窗口仍在的证据。
- `queue --resume` 不满足本任务的退出取消边界；仅去掉 `--resume` 也不能证明持久队列不会在之后被消费。

### Claude Code

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks#sessionend)：存在 `SessionEnd` 清理入口，也存在 `UserPromptSubmit`、`Stop` 等事件。
- `SessionEnd` 是正常生命周期入口，不能据此假定进程崩溃、被强制结束或连接异常时一定会运行；异常退出仍需通过宿主取消或进程边界验证。
- 尚未验证自定义等待工具如何同时处理人工输入、超时和退出取消，不宣称原生提问能力已经满足本功能。

### OpenCode

- [OpenCode Server](https://opencode.ai/docs/server)：TUI 与 server 分离，支持向会话发送消息、读取状态与中断；独立 server 可以在没有 TUI 时存在。
- 因此 server 存活或 session 仍存在不能证明用户主窗口仍打开；需要额外验证前端生命周期绑定。
- 尚未实现或实测对应适配器。

## 待收敛的技术问题

- 优先研究在当前主会话内通过可取消的等待工具返回结果；该能力需要平台输入/取消接口，不能用普通 `sleep` 冒充完整确认交互。
- 必须同时验证人工输入可及时取消、超时可继续、窗口退出可取消；仅具备其中一项的平台不应启用自动模式。
- 由首版目标 Harness 决定具体接入点，再确定是否需要额外工具注册、插件或会话启动入口；当前不能承诺完全不修改宿主接入方式。
- 时长、默认动作和默认开启方式已由用户决定并记录在 `prd.md`；接入研究新增的前台启动方式取舍仍需收敛，不从仓库现状代用户选定。
