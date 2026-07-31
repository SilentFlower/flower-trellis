# SRM 无任务流程会话复盘

## 会话范围

- 项目：`/root/project/srm`
- 平台：Codex
- Session：`019fb5e1-f67b-7c21-80b1-2ab98b51afd5`
- 时间：2026-07-31

## 关键时间线

1. 用户明确要求“不用 task，快速修改”。Agent 以无任务方式完成单点修复、同类扫描和 5 个调用点修改。
2. 用户说“下一步”后，Agent 能继续静态检查和提交准备，但没有一个显式的无任务阶段状态作为依据。
3. 用户说“走 Trellis 流程”后，Agent 将其解释为显式任务规划，并执行：

   ```bash
   python3 ./.trellis/scripts/task.py create "修复钉钉卡片接收人字段映射" --slug fix-dingtalk-card-receiver-userid
   ```

4. 用户随即澄清“不用走任务”，Agent 没有正式的无任务切换 helper 可用，于是执行：

   ```bash
   gio trash /root/project/srm/.trellis/tasks/07-31-fix-dingtalk-card-receiver-userid
   python3 ./.trellis/scripts/task.py finish
   ```

5. 任务目录删除后 session 仍保留 stale pointer，导致额外恢复步骤。
6. 清理完成后，Agent 在 `task=N/A` 下完成 Full Check、Update-Spec 和双仓 Push 计划，证明下游能力本身可以支持无任务模式。

## 根因

### 规则断层

- Request Triage 和 `[workflow-state:no_task]` 允许 untracked `direct_edit`。
- Phase 2.1 的详细契约要求实现必须存在 `in_progress` task。
- `no_task` breadcrumb 只规定如何进入 direct edit，没有规定 direct edit 后如何经过 Check-All、Update-Spec、Push 完成。

### 继承语义缺失

- 同一事项中的“下一步”“继续”“走 Trellis 流程”没有稳定绑定到当前无任务模式。
- Agent 因“走 Trellis 流程”关键词重新执行 task intent 推断，忽略了同一事项已经进入 untracked direct edit。

### 状态转换缺失

- `task_intent.py discard` 面向 auto-created planning task；本次误建任务使用普通 `task.py create`。
- 缺少正式的 untracked -> task 和 task-planning -> untracked 状态转换协议，促使 Agent 手工删除任务目录。

## 已有可复用机制

- `pre_check_state.py` 已实现 session context 隔离、compact/resume 恢复、任务匹配、原子 JSON 写入和保留其它 runtime 字段。
- workflow hub 已规定交互完成顺序为 Check-All -> Update-Spec -> Push。
- Check-All、Update-Spec、Push 已能在无活动任务时运行，主要缺口是入口状态、阶段推进和恢复契约。

## 初步结论

应把 untracked direct edit 建模为 session 级正式状态，而不是只扩写提示词。状态 helper 负责事项范围、阶段、切换和清理；workflow/hook 只注入一跳动作；各 owner skill 继续持有 Check-All、Update-Spec 和 Push 的完整规则。

## 路由设计补充

- 无任务事项不需要复用 task-scoped `route_decisions`；它们的合法性校验强绑定 current task path。
- `.trellis/.route-prefs.tmp` 的读取、mode 归一化和写入逻辑已经独立存在于 `route_state.py`，可以增加不依赖 current task 的偏好命令。
- 无任务 implement/check 每次直接解析个人默认；没有偏好时展示现有选择。“仅本次”不持久化，“保存默认”只更新 `.route-prefs.tmp`。
- sub-agent 需要新的 `Untracked work: <id>` dispatch 契约，直接携带事项摘要、范围、baseline、阶段、验证证据和 spec 路径，不读取不存在的 task JSONL。

## Baseline 约束

- 根仓 porcelain 状态只能看到 submodule 指针 dirty，不能替代子仓内部文件基线。
- untracked baseline 必须覆盖根仓、已初始化递归 submodule，以及 `.trellis/config.yaml` 中声明为独立 Git package 的仓库。
- `auto_loop.py` 已有根仓和递归 submodule 的 baseline 实现，可作为算法参考；独立 Git package 需要结合 Trellis package config 补齐。
