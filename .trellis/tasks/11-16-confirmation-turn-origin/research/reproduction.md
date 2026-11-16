# 来源丢失复现

## 代码证据

- `src/assets/flower_confirmation_runtime/codex.py:178`：只有当前 request.state 为 consumed 时才提取原请求 ID 与人工基线。
- `src/assets/flower_confirmation_runtime/codex.py:309`：内部输入必须匹配该 prior 请求。
- `src/assets/flower_confirmation_runtime/claude.py:245`：内部通知来源匹配同样绑定当前 consumed 请求。
- `src/assets/flower_confirmation_runtime/runtime.py:195`：prepare 返回整体新状态并替换当前 request。

## 隔离复现方法

使用现有 `ProjectFixture` 在系统临时目录复制作者源与策略。建立一条已完成的 consumed 请求、真实人工消息基线及属于该请求的原生内部唤醒记录。

Codex 写入 session_meta、task_started、包含准确 client_id 和 wake_message 的 UserMessage。RPC thread/read 和窗口采集使用隔离替身。Claude 写入结构化 human 与 task-notification，native 的 runId、promptId 和 tasks 与原通知对应。

调用真实 runtime.prepare、真实策略子进程与适配器。第一次准备成功后执行 runtime.cancel，再用全新的适配器实例准备一次。两端均稳定复现失败。该复现核验进程间持久状态的客户端恢复方式；正式 CLI 子进程与原生 TUI 属于后续验收层级。

## 实际输出

```json
{"platform":"codex","firstPrepare":true,"cancelled":true,"secondPrepare":false,"reason":"Codex 当前回合的队列唤醒来源不符"}
{"platform":"claude","firstPrepare":true,"cancelled":true,"secondPrepare":false,"reason":"当前回合缺少可核验的完整记录，保持人工确认"}
```

执行命令为 `PYTHONDONTWRITEBYTECODE=1 python3` stdin 程序，临时项目由 unittest cleanup 回收。实现前复现阶段仅核验失败路径。

## 所有权和验证入口

Flower 运行时由 `src/assets/` 直接分发，受管投影位于 `.trellis/scripts/`。共享协议的作者源位于 `vendor/skill-garden/.trellis/0.6/scripts/confirmation.md`，enhancements 是快照。确认机制自身开发任务必须人工评审。

当前 Git 工作区有既有容量和 Windows 改动。新任务 task.json 的 intentRouting.baseline 保存了两仓基线。现有 CI 对 Python 套件运行 Ubuntu/Windows × 3.8/3.12，Ubuntu 3.8 的实际 runner 为 ubuntu-24.04。

## 补充：Claude 技能元消息

用户在实施期间补充 cnooc-virtual-mall-data 的 Claude 截图。本次只读检查定位到会话 `6d3504a9-b6b9-431c-8f3f-d4629a696d33`。该会话 2026-11-16T05:12:33Z 实际 prepare 返回“Claude 消息来源字段不可核验，保持人工确认”。

原始会话第 416 行是真实人工“确认”，origin.kind 和 turnOrigin 均为 human。第 874 行是技能重复调用的字符串元消息，`isMeta=true`，两个来源字段均缺失，并且共用该人工回合的 promptId。当前定位会从文件尾部匹配同一 promptId，遇到此行时直接抛错。第 887 行的完整技能说明为列表内容，同样带 isMeta。

新增两宿主分支回归在修复前均复现同一错误。修复边界是仅跳过原生明确标注且无来源字段的元消息。业务仓库与真实会话记录保持只读使用。
