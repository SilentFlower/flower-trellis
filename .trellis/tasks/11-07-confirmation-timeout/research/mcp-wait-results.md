# 统一前台入口 + MCP 等待实验结果

- 日期：2026-11-07；阶段为 planning / Phase 1.2。
- 用户已接受两平台统一入口与标准等待工具，并明确授权隔离实验。
- 本机 Linux，实际 Codex 0.167.0、Claude Code 2.1.293，普通 TUI，经 PTY 观察。
- 所有 Responses / Messages 均由 127.0.0.1 mock 回答，使用 dummy；无真实模型推理。未调用当前真实用户线程、共享 daemon、queue、resume、commit 或 push。
- 关键时序已保存到 [mcp-wait-evidence.json](mcp-wait-evidence.json)。来源目录保存在每组 source 中；不复制完整提示、header、凭据或原始请求。

## 实际结果

| 场景 | Codex | Claude |
| --- | --- | --- |
| 三秒到期，无人工输入 | 通过；3.000s 返回 policy_timeout，第二次主请求消费结果 | 通过；3.001s 返回 policy_timeout，第二次主请求消费结果 |
| 等待约0.5秒后输入取消 | 通过；0.502s 先撤销再透传，返回 cancelled，原截止后无默认动作 | 通过；0.503s 先撤销再透传，返回 cancelled，原截止后无默认动作 |
| 等待约0.5秒后关闭前台入口 | 通过；CLI退出，跨过原截止后无新主请求，结果时CLI已不存在 | 通过；CLI退出，跨过原截止后无新主请求，结果时CLI已不存在 |
| 等待约0.5秒后 SIGKILL 控制器 | 通过；内核父进程死亡绑定使CLI退出，观察窗口内无新主请求 | 通过；同一协议、同一Linux绑定成立，观察窗口内无新主请求 |
| 等待约0.5秒后 SIGKILL CLI | 未单独运行此场景 | 通过；控制器观察到CLI退出并取消待决，无新主请求 |
| 200秒到期，无人工输入 | 通过；等待200.000s，第二次主请求消费 policy_timeout；未提前yield或模型轮询 | 通过；等待200.000s，第二次主请求消费 policy_timeout；未转后台或模型轮询 |

共11组有效场景，均通过。三秒与200秒场景没有混算；单次 Allow 的预配置对照没有混入无需本次授权输入的正式结果组。退出场景的 mock 位于外层旁观器，在关闭 / 强杀控制器后继续运行至原截止之后，再统一清理，不能靠提前关服务掩盖后续请求。

close-window 场景通过入口的 close 控制消息模拟正常关闭；SIGKILL 场景使用真实进程信号。没有直接关闭真实桌面终端或断开 SSH，真实 PTY HUP / 输入 EOF 仍属于正式验收范围。

所有有效场景的结束清理记录均为 live_processes=0。关闭 / 强杀结果还单独核对 harness_alive_at_result=false，不把“控制器已退出”直接当作CLI也已退出。

## 成功路径

1. 同一服务只暴露一个 `wait(request_id)` 工具。
2. mock 在同一主响应中先展示 `FLOWER_MCP_PLAN`，再调用 wait。
3. 前台控制器同时看到方案标记与真实等待请求后才 arm，避免终端渲染先后顺序造成提前计时。
4. 计时在控制器本地运行，不做每秒模型请求；人工输入先使等待失效，再传给真实CLI。
5. MCP 返回短 JSON，原调用链消费结果；没有依赖空闲后台完成通知启动新回合。
6. 原生CLI和MCP只属于当前入口；Linux通过PR_SET_PDEATHSIG做强杀对照，不依赖 finally 或 SessionEnd 一定运行。

## 两个需要正确配置的宿主细节

### Codex

- 保持 on-request 和 read-only 研究沙箱；仅为 `flower_confirmation_probe.wait` 单次设置 `approval_mode="approve"`，已验证从启动到结束不再需要本次工具授权输入。
- `auto` 仍弹原生授权菜单，不是预批准。此前单次 Allow 只证明“许可后可无人输入到期”，没有将它算成从启动全无人输入。
- 不使用全局 never，不点击未知持久化范围的 Always allow，不修改用户全局配置；详细依据见 [MCP审批研究](codex-mcp-approval-research.md)。
- 通过真实 functions.exec / ALL_TOOLS 发现实际工具名。该代码环境没有 TextEncoder，计数字节使用标准字符串编码方法；不能用普通 Node 环境的全局对象推断代码执行器能力。
- 200秒实验使用该代码工具自身已声明的 yield_time_ms 配置扩大等待，保持一个未完成的 MCP 调用；实际未出现 pending cell 或额外模型请求。

### Claude

- 普通TUI的MCP工具发现异步完成。初始 prompt 与启动参数同时传入时，首次模型请求可能尚无工具；本实验先等实际 tools/list 完成再提交首条实验消息，之后工具定义可见。
- 单次注册精确 wait，研究中以 ENABLE_TOOL_SEARCH=false 观察真实定义；正式产品应保留用户原有工具发现策略。
- CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0；工具总预算和idle预算覆盖200秒与返回余量。未使用 bare 替代普通TUI。
- 隔离配置只复制此前研究fixture的非凭据onboarding/dummy批准字段；新目录信任由根在实际原生菜单中处理，发生在工具等待之前。

相关官方配置：[Codex工具预算与策略](https://learn.chatgpt.com/docs/config-file/config-reference)、[Claude MCP环境变量](https://code.claude.com/docs/en/env-vars)。协议按 [stdio传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[初始化](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[工具调用](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)核查。

## 上下文开销

| 观察对象 | UTF-8字节数 | 含义 |
| --- | ---: | --- |
| 服务端原始 wait 定义 | 255 | name、短description和单字段inputSchema |
| Claude实际展开工具定义 | 286 | 宿主添加MCP命名后的完整定义 |
| Codex code-mode登记元数据 | 313 | runtime中实际选中的工具name和生成描述，不等于已精确测得的前置prompt增量 |
| 正常超时结果JSON | 70 | request_id / source / decision |
| 人工撤销结果JSON | 84 | 含human_input原因 |

单工具定义和结果均为几百字节以内。当前方案不把Brief全文、问题报告、Git计划或审计日志放进定义 / wait参数，也不输出每秒tick。200秒等待期间，两个平台都保持首次主请求之后无新主请求，工具返回才进行第二次主请求。

Codex现有functions.exec包装定义为14721字节，是宿主已有的代码执行工具；不能把整个包装都算作新增MCP成本。正式接入还会产生少量调用参数、流程说明与宿主包装，不能只把70字节结果当作全部上下文。

本轮没有取得真实模型分词 / 计费token；本地参考分词器需要取远端数据而未完成，已停止该独立统计进程。因此只报告实测字节，不虚构固定token数，也不使用mock返回的占位usage作真实计费证据。

## 仍需正式实现与验证

- 探针展示的是固定方案标记，不是完整Brief / 检查报告 / Git计划；正式实现须核验完整材料和版本，不能只识别标记就放行。
- 探针只有等待阶段的决定，没有实现timeout_ready后的领取、领取前输入撤销、材料变化、重复领取或真实动作。这些在 design / implement 中列为正式合同和必测项。
- 用户手动重开旧会话、临界竞争、执行已经开始后的退出、100 / 130秒分别实测尚未进行；200秒只证明长调用链路可持续。
- Linux父进程绑定不构成Windows / macOS证据，当前没有原生Windows或IDE验收；正式支持必须通过其原生验证。
- 当前只有 research/probes 脚手架与任务材料，没有发布 `ftl session`，没有启用本项目的自动确认策略，不能用尚未实现的功能批准本任务自身。
