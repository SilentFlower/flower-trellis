# 统一会话入口与 MCP 限时确认设计

## 目标与已确认边界

- 对应 PRD R1–R12：首版 Codex、Claude 共用一套计时与决定逻辑；其他 Harness 按能力接入，未验证时保持人工。
- 统一入口拟为 `ftl session -- codex [原参数]`、`ftl session -- claude [原参数]`。`flower-trellis`、`ftl`、`ft` 沿用现有别名。
- 用户已接受两平台都增加前台入口，并授权隔离实验。原生后台完成通知的先行实验保留在 research，不再为两平台维护两套默认触发路径。
- 完整 Brief 已获批准，当前处于 in_progress。research/probes 是验证脚手架；正式实现、检查与 CI 单独验收。

## 架构与所有权

| 部分 | 职责 | 持久作者源 / 接入位置 |
| --- | --- | --- |
| Flower session 命令 | 解析入口、选择已验证 Harness、保留其原参数、启动前台控制器 | `src/cli.js`、`src/lib/cli-args.js`，新增 `src/commands/session.js` |
| 通用控制器 | PTY、当前实例身份、计时、人工输入、一次性领取、退出和最小审计 | 新增 Flower `src/lib/confirmation-session.js`；协议逻辑按实际复杂度拆为小模块，不建立插件框架 |
| 单工具 MCP 服务 | 仅暴露 `wait`，把等待结果交回尚未完成的原工具调用 | Flower 包内运行时，通过本次启动参数注册；不写用户全局 MCP 配置 |
| Harness 接入 | 单次 MCP 注册、原生工具预算、受控前台模式、可靠展示 / 会话证据 | Codex / Claude 的薄接入层；不复制计时和决定规则 |
| Trellis 流程桥接 | 按当前流程准备方案摘要、读取策略、等待和领取决定 | `vendor/skill-garden/.trellis/0.6/scripts/` 新 helper；只通过受管投影交付到 `.trellis/scripts/` |
| 三个流程 owner | 展示材料、判断授权、核对方案与前置条件、执行原动作 | vendor 的 `.agents/skills/`、`.claude/skills/` 中 Brief、Check-All、Push 与必要 workflow Patch |

`src/lib/trellis-runner.js` 的 PTY 清理经验和 `terminal-state.js` 的终端恢复可复用，但不会把运行 Trellis 子命令的函数直接当成 Harness 控制器。正式入口保留已有工具和用户配置；研究探针中禁用其它 MCP / 内置工具、dummy provider 和固定提示词均不进入产品默认配置。

## 会话与等待协议

以下为拟新增的 Flower 内部字段，不是臆造的 Harness 参数。

1. 启动器生成本次 `instanceId`、随机控制凭据和本地 IPC；校验当前项目、平台、版本、MCP 可用性与进程退出绑定。只给自身管理的会话提供超时能力。
2. 流程桥接准备一个不可变的请求：`requestId`、`kind`、当前任务 / 会话、方案版本、材料摘要、Git 计划模式及基线（提交场景）、策略来源和默认动作。准备不开始计时。
3. 流程 owner 冻结完整材料；调用 wait 时由前台控制器直接展示该正文、默认动作和时长，写入终端并排空后才计时。展示期间暂缓原生界面重绘，正文进入主屏回滚区，结束后恢复原生界面。计时依据是控制器持有的确切正文，不依赖模型结束标记。
4. 模型调用唯一 MCP `wait(request_id)`；方案正文、配置和审计不塞进工具参数或工具描述。准备、有效性检查和领取由流程 helper 与控制器完成，不为此暴露一组额外模型工具。
5. 控制器在同一事件循环中处理输入、截止和退出。用户输入先撤销许可再透传；等待阶段保守地把真实终端按键视为介入，不把按键解释为同意。终端设备应答不作为人工决定。
6. 到期返回简短结构化结果，例如 `{"request_id":"…","source":"policy_timeout","decision":"continue"}`。人工介入返回 cancelled；不记录为 human approval。
7. 工具返回后，流程 helper 必须再次领取该决定：核对当前实例、请求版本、材料 / Git 基线和有效授权。成功领取是自动动作开始边界；领取之前到达的人工输入仍能使旧决定失效。
8. 领取成功才进入原动作，继续遵守 owner 的执行和验证合同。任何过期、重复、跨实例、版本变化、失联或未授权请求均不能领取。

工具等待保持原调用链活动，不发送 queue、resume、终端模拟自然语言消息或持久唤醒任务。宿主若把长代码执行包装返回为 pending，适配必须遵循其真实等待工具继续当前调用，不能把 pending 当作超时同意。

## 状态与竞争

`prepared → waiting → timeout_ready → claimed → finished`

- `prepared / waiting / timeout_ready` 均可被人工输入、方案变化、关闭入口或 IPC 断开转为 cancelled。
- 同一 request 只可完成一次领取；重复 MCP 通知和重试可以得到同一结果，不能重复产生执行许可。
- 截止先准备 timeout_ready，领取时再校验，使“工具已经返回但默认动作尚未开始”的输入仍有撤销机会。
- claimed 后的退出属于 PRD R5：按宿主中断能力停止后续执行，并如实记录已完成、已中断或待核验，不能将既有副作用抹去。
- 活许可只存在于本次进程内存；落盘记录仅审计，不是可重放授权。重新启动生成全新实例，不恢复旧事项或定时器。

## 计时与配置

项目 `.trellis/config.yaml` 新增 `confirmation_timeout` 配置块，默认 enabled，支持项目级和三类确认分别关闭、按秒配置。

- Brief：以规范化换行为 LF、去除文件首尾空白后的完整 brief 正文 Unicode 字符数计数，默认 `100 + ceil(max(0, count - 1000) / 500) × 30` 秒；文件末尾换行不额外计字。
- 检查：当前报告实际待处置项去重后计数，零条不等待，否则默认 `100 + (count - 1) × 30` 秒；不把标题、说明段或已处置项目算成新增问题。
- 提交：默认 200 秒，绑定已展示的精确文件、目标仓库 / 分支、Git 基线及原模式，普通模式 commit + push，明确 commit-only 时才本地提交。
- 字符、条数和时长规则只有一个实现；新增 / 变更材料必须重新计算并展示。
- 复用现有配置读取入口时，显式解析字符串布尔 / 正整数，区分缺失配置与损坏配置。损坏、无效或预算不足时保持人工并给出原因，不能把 `"false"` 当真，也不能截短用户等待时间。
- 原生 MCP 总预算必须覆盖本次实际时长和返回余量；Claude 关闭 MCP 自动后台化。预算超出或接入不受控时不自动选择。正式配置解析与 update 保留测试共同覆盖默认和显式值。

## 平台接入与退出

- Codex：通过单次配置注册本工具，并对该工具使用已验证的精确 `approval_mode="approve"`。保留其它工具的权限策略；使用 `--no-daemon`，不附着共享 daemon / remote。`auto` 与 approve 不同，不能将其当作免询问保证。
- Claude：单次注册同一工具，精确允许该工具；保留普通 TUI，关闭本次 MCP 调用自动后台化。原参数继续交给原生CLI，只有工具发现完成才允许 prepare；首轮尚未就绪时保持人工。实验先等工具就绪再提交固定任务。正式运行不使用研究模式的 `--tools ''`、strict 隔离、dummy key 或关闭历史设置。
- POSIX 正常退出 / HUP 先撤销再结束自有进程。Linux 已以父进程死亡信号验证入口强杀场景；正式进程树清理仍须覆盖 CLI、MCP 与辅助后代。
- Windows 必须提供原生进程生命周期约束和 ConPTY 清理，并在原生 CI 验证；不能将 Linux 的 prctl 探针当作跨平台实现。其他未验证平台不开放自动模式。
- 接入只为当前前台窗口持有许可；server PID、历史 session、活动任务唯一回退、晚到的 SessionEnd 都不能代替窗口存活证明。

## 流程与分发

- Brief：只有匹配当前材料的有效 timeout 决定才能替代首次人工开工确认；不得利用尚未实现的功能批准本任务本身。
- Check-All：默认修复当前报告全部待处置问题并重检；新增业务取舍暂停，不自动接受风险。无问题的原有完成链保持原样。
- Push：只对当前已展示且有效的精确计划决定；领取后仍重查 Git 范围和基线，不扩大文件、仓库、分支或操作模式。
- 已验证 auto-loop 的预授权继续归原 runner 管理，不叠加交互式计时。
- 更新 `src/assets/flower_session_start.py` 中交互指引：有可核验超时许可时进入本协议；普通问题继续同步确认，不为现有 request_user_input 添加不存在的 timeout 字段。
- 两套脚本选择性投影同时维护：`src/lib/copy-scripts.js` 与 `src/builtin-plugins/skill-garden/content-adapter.js`。新配置块加入 `src/lib/config-preserver.js` 的更新保留范围。
- 作者源 → `npm run sync` 快照 → compiled targets → 生命周期安装 / update / uninstall；不得只编辑部署副本。原模板与 Patch 继承目标语言风格。

## 上下文成本与证据限制

- 只提供一个短 wait 定义和短结果，不复制方案正文，不输出每秒 tick，不轮询模型。
- Phase 1.2原型：MCP定义255字节、Claude展开286字节、Codex元数据313字节、超时结果70字节；既有Code Mode包装14721字节不是本工具新增成本。正式实现定义386字节、Claude展开314字节、UUID超时结果101字节，Codex最新元数据未单独采集；流程指引和准备/领取输出另计。
- 字节不是 token；未使用 mock 的虚构 usage 作为真实计费。上下文结构与成本随宿主包装、工具发现方式和模型分词变化，不承诺固定 token 增量。
- Linux产品入口的100/130/200秒、最终短场景、人工撤销和强杀已实测，详见 research/production-session-results.md。准备/展示/领取竞争、旧实例拒绝、原生SessionStart、分发与配置保留有专项覆盖；原生Windows和匹配提交的CI仍待推送后验收。所有模型响应均为回环mock，不替代真实业务修复或Git执行。

## 回退与发布

项目 / 单类关闭、原生直接启动、版本或 IPC 不符、工具权限 / 等待预算不足、展示或材料无法核验时回到现有人工确认。卸载移除受管接入，不停止或修改无关用户会话，不保留唤醒队列。实现与测试通过后，按 Check-All → Spec → 精确 Push 计划完成交付；推送前仍按现有门禁确认。

## Check-All 修复增量

- CHK-001：只为 `confirmation.md` 启用现有目标 Python 命令物化；Plugin 投影复用 provider 已解析的命令，legacy 投影按目标证据解析，Python 脚本本身保持原字节。
- FBK-001：审计首次失败后，本实例停止发放自动许可并撤销未领取请求；取消、输入透传、已开始动作的真实结果记录和清理不因审计异常中断。关闭连接与监听放在确定性清理路径，重复关闭等待同一结果。
- FBK-002：异步材料检查也由随包守护器启动，绑定当前实例的生命连接和 Linux 进程组 / Windows Job。正常检查只返回其检查结果，不写入 Harness 退出码；入口退出、生命连接断开或检查超时结束整个检查进程树。
