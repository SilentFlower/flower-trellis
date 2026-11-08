# 前台限时确认

本协议用于 Brief 首次开工、Check-All 问题处置、Push 精确计划。项目默认启用，由助手在当前原生窗口直接运行 `ftl confirm`。原版 Codex 需能核验原连接，Claude Code 需能核验当前终端和项目 Hook；能力缺失、配置关闭或失联时沿用人工。已校验的 auto-loop 继续用 runner。Spec 歧义、未决业务取舍、风险接受和独立权限审批仍由人工决定。

1. **检查能力。** 用当前主对话的内置 Shell 调用 `ftl confirm status`。只在 `protocol=1`、`bound=true`、`ready=true`、`enabled=true` 且本类 `kinds.<brief|check|push>=true` 时继续。命令缺失、诊断异常或 `manual=true` 时，简述原因，照常完整展示并等待人工。
2. **准备材料。** 按当前流程的原模板形成完整正文，保留全部范围、风险与生成命令。Brief 的 `file` 必须是最新的 `<task>/brief.md`；检查和 Git 计划用 `body` 提供完整正文，或用已冻结的项目内相对 `file`。可用 `python3 -X utf8 .trellis/scripts/confirmation.py materialize` 从 stdin 冻结较长正文，结果只写入 gitignored runtime。可选 `basis` 填项目内证据路径；检查 `problem_ids` 列全当前待处置 CHK/FBK/DOC；提交明确 `mode: "push"|"commit-only"`，单仓用 `git_paths`，多仓用 `repositories: [{"root":"仓库路径","git_paths":["精确文件"]}]` 按计划顺序列全。
3. **前台等待。** `prepare` 从 stdin 读取单行 JSON，输出 `request_id`、`review`、`seconds`、`kind` 和 `action`，此时未计时。把 `review` 原样作为一条普通、可见的助手正文发送，再调用 `ftl confirm <request-id>`。不要加导语、引用、代码围栏、截取末段或用链接替代正文。Claude 把正文和 Bash 调用放在同一条助手消息，Bash 用 `timeout: 600000` 和 `run_in_background: false`；Codex 使用内置 `exec_command`，若返回会话 ID，只用 `write_stdin` 空输入等同一进程，Code Mode 若先让出则等待同一单元。不要用 `&`、后台任务、定时唤醒或重复运行等待命令。Shell 工具输出不是展示回执。
4. **核对并执行。** 仅当该前台命令成功返回同一 `request_id`、`source=policy_timeout`、`decision=continue` 且 `kind`、`action` 均匹配时，本次范围选择才被领取。立即按原 owner 的前置条件与精确范围执行；用户回复、取消、材料变化、预算不足或错误时停止旧决定并转人工。不得重试已取消或已领取的决定，也不能把它带到另一个回合。真实执行结果用 `ftl confirm finish <request-id> <completed|interrupted|needs_verification>` 记录；失联后核实已发生的副作用。

`prepare` 例子（用实际材料替换 JSON；分隔符保持单引号，避免 Shell 展开）：

```bash
ftl confirm prepare <<'FTL_CONFIRM_SPEC'
{"kind":"brief","file":".trellis/tasks/实际任务/brief.md"}
FTL_CONFIRM_SPEC
```

| kind | 默认时长 | action | 匹配后的动作 |
| --- | --- | --- | --- |
| brief | 正文 1000 字内 100 秒；每多 500 字加 30 秒，不足一档按一档 | implement | 对已展示的 Brief 运行 `task.py start` |
| check | 第一条 100 秒，每多一条加 30 秒；零条不等待 | repair_all_and_recheck | 修复当前全部待处置项并重检；新业务取舍暂停 |
| push | 200 秒 | execute_git_plan | 按当前精确计划提交并推送；明确 commit-only 时仅本地提交 |

自动决定记为 `policy_timeout`，人工明确回复记为 `human`。项目或单类可在 `.trellis/config.yaml` 的 `confirmation_timeout` 中设置 `enabled: false`；缺失使用默认，损坏或超过预算时人工确认，不截短等待。运行记录不入 Git，也不能在窗口重开时补跑。
