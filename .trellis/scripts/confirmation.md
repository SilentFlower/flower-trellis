# 会话内超时确认

本协议只服务 Brief 首次开工、Check-All 问题处置、Push 精确计划。必须由 `ftl session -- codex|claude` 管理当前前台会话；普通原生启动、其它 Harness、无效配置和失联均继续人工确认。经校验的 auto-loop 使用原 runner，不叠加本协议。Spec 歧义、未决业务取舍和独立权限审批不能自动作答。

## 先确认能力

执行 `python3 .trellis/scripts/confirmation.py status`，项目选用其它 Python 命令时沿用该命令。只有结果同时为 `bound=true`、`ready=true`、`enabled=true`，且 `kinds.<brief|check|push>=true` 才准备自动确认。`server_name` 是本次随机注册的 MCP 名称；只能调用它实际提供的 `wait`，找不到工具就回到人工。禁止给 `request_user_input` 添加 timeout 字段、启动定时唤醒或每秒询问模型。

## 冻结、展示与领取

1. 先按流程 owner 形成完整材料，保留原模板、全部范围和风险。Brief 直接使用最新 `<task>/brief.md`。检查报告和 Git 计划将完整正文送入 `confirmation.py materialize` 的 stdin；结果给出 gitignored `.trellis/.runtime/confirmations/materials/<id>.md`。该文件仅用于当前跨进程校验，不是导出附件，不放入任务交付或 Git 计划。禁止用 shell 插值生成正文。
2. 执行 `confirmation.py prepare --kind <kind> --file <正文相对路径>`。关联依据逐个加 `--basis-file <相对路径>`；检查为当前**全部待处置**条目逐个加 `--problem-id CHK-1`（同样接受 FBK/DOC）；提交必须加 `--mode push|commit-only` 及逐个 `--git-path <精确文件>`。多仓逐个加 `--repository '{"root":"仓库路径","git_paths":["精确文件"]}'`，按原计划顺序列出，当前主仓也可用此格式；任务记录、生成命令和预计输出仍完整写在原计划正文中。prepare 成功不计时。
3. 使用返回的 `request_id` 调用本次 MCP `wait(request_id)`。控制器直接向用户完整展示冻结正文、默认动作和实际秒数，排空后开始计时；这次可信终端展示满足对应 owner 的完整展示要求，无需另输出一份正文。不得以模型结束标记、仅文件链接或自行估算时间替代。按宿主工具协议等待原调用完成，pending 时继续原等待，不创建第二次决定。
4. 只有 `source=policy_timeout`、`decision=continue` 才执行 `confirmation.py claim --request-id <id>`。**claim 成功**且返回的 kind/action 与本次 owner 匹配，才替代该次人工范围选择。工具返回后、claim 之前到达的人工按键仍会撤销旧决定。claim 拒绝、取消、版本变化、工具失败或预算不足时保持人工；不得重试领取来重复执行，也不得把 cancelled 当成拒绝业务方案，用户回复仍由 owner 解释。
5. 领取后仍遵守 owner 全部检查、前置条件、文件与分支范围。动作结束执行 `confirmation.py finish --request-id <id> --outcome completed|interrupted|needs_verification`，据实际结果选择；失联时如实报告已完成副作用和待核验项，不能声称撤销。活许可只存在于本次入口内存，重开不会消费旧请求。

## 默认动作

| kind | 时长默认值 | claim.action | 领取后的动作 |
| --- | --- | --- | --- |
| brief | 正文1000字内100秒，之后每500字加30秒，不足一档按一档 | implement | 对这份已展示且有效的方案运行 `task.py start`，进入实现 |
| check | 第一条100秒，每多一条加30秒；零条不等待 | repair_all_and_recheck | 修复当前报告全部待处置项并重检；新业务取舍暂停，风险接受仍必须人工明确决定 |
| push | 200秒 | execute_git_plan | 沿用当前计划和模式；普通 commit + push，明确 commit-only 时仅本地提交 |

报告必须把自动决定来源写为 `policy_timeout`，不能写成“用户已经确认”。人工分支由原 owner 核对真实回复并记 `human`；按键取消本身不是批准。prepare 重试复用同一请求，已领取或撤销的同版本材料不能重新自动执行。材料、范围、模式、Git 基线或会话变化后，旧请求失效；更改方案必须重新冻结和展示。显式只读、暂停、停止、拒绝或用户更改范围时不准备自动决定。项目默认启用，`.trellis/config.yaml` 的 `confirmation_timeout.enabled: false` 可关闭；各类的 `enabled` 和秒数配置独立，缺失采用默认、损坏回人工，不得临时缩短用户时长来促使当前动作执行。
