# 输入基线故障与改造依据

## 已核验事实

- 现场项目：`/root/project/cnooc-virtual-mall-data`。Claude 主进程的工作目录与截图项目一致。
- 会话：`8bd8489a-d726-4bd0-942d-74db8da07610`。
- 原始记录：`/root/.claude/projects/-root-project-cnooc-virtual-mall-data/8bd8489a-d726-4bd0-942d-74db8da07610.jsonl`。
- 第 304 行：当前回合 `1e480854-e19e-4d00-b37d-b416ddc82464`，`origin.kind=peer`、`turnOrigin=peer`、`isSidechain=false`；内容为 `trellis-research` 子代理回传。
- 第 380 行：主会话调用项目 Python 入口执行 Brief `prepare`。
- 第 381 行：返回 `prepared=false`、`mode=manual`，原因为“当前回合缺少可核验的完整记录”，尾部标识与第 304 行一致。
- 检查时日志为 1,862,197 字节，完整落在现有 32 MiB 定位窗口内。搜索窗口容量不是本次故障原因。
- 只读复现：以现场日志调用现有 `SessionLog.locate` 和 `ClaudeClient._consume_transcript`，得到同一错误；该 peer 记录解析出的人工基线为空。
- 现场 `claude.py` 与本仓库部署版 `.trellis/scripts/flower_confirmation_runtime/claude.py` 的 SHA-256 相同：`845e61e902513c2a3385a55ce2349148dac4d7686a46f4dede4c1b36135c7bcd`。

## 源码与影响面

| 位置 | 当前行为与改造含义 |
| --- | --- |
| `src/assets/flower_confirmation_runtime/claude.py:119` | `UserPromptSubmit` 更新当前回合；非自有通知分支把回合 ID 写入 `humanId`，混合了回合与人工来源。 |
| `src/assets/flower_confirmation_runtime/claude.py:255` | `prepare` 的定位谓词只接受人工输入或已消费的精确内部通知。 |
| `src/assets/flower_confirmation_runtime/claude.py:318` | 日志消费仅提取 human 和 task-notification，peer 不能建立人工基线。 |
| `src/assets/flower_confirmation_runtime/codex.py:22` | 已有 UserPromptSubmit / Interrupt Hook、代次更新和旧请求取消。 |
| `src/assets/flower_confirmation_runtime/codex.py:187` | 准备仍依赖原始人工消息定位、恢复链回溯和 `humanId`。 |
| `src/assets/flower_confirmation_runtime/runtime.py:150` | 两次准备快照、状态落盘、领取及 started 均使用人工消息 ID。 |
| `src/assets/flower_confirmation_runtime/store.py:104` | `turnOrigin` 校验强制要求 `inputId` 和 `baselineMessageId`；来源类型限制为 human/internal。 |
| `src/lib/confirmation-lifecycle.js:42` | 确认资产实际升级前通过随包 Python 取消旧请求；dry-run 与无变化更新保留状态。 |

这些行号以本次规划时的文件为准。实际实现先重新定位目标定义。

## 宿主事件边界

- `flower_confirmation_hook.py` 原样转发宿主 JSON，单次子调用预算 4 秒；平台 Hook 配置属于 Flower 自有 Patch。
- 现场 Claude 映像为 `@anthropic-ai/claude-code/bin/claude.exe`。只读检查映像内的当前 Hook 构造内容，公共载荷包含 session、transcript、cwd、可选 prompt_id 和 agent_id；UserPromptSubmit 追加 prompt。当前构造内容未提供结构化 origin 字段。
- 因此不能假设 Hook 名称等同真实用户输入，也不能凭消息正文认定 peer 或自动确认提醒。必要分类应来自当前会话的原生事件/新增日志记录。
- 回合 ID、后台 task ID、队列 client_id 和 Flower 请求/回执 ID 仍分别用于回合展示、通知关联与单次执行。取消历史人工 ID 门槛不等于删除这些身份。
- Codex 当前已有主动取消路径。应在共同运行时替换基线契约，避免只修 Claude 后留下两套许可判断。

## 作者源与验证入口

- Flower 源码：`src/assets/flower_confirmation_runtime/`、`src/assets/flower_confirmation_hook.py`、`src/assets/flower_confirmation.py`、`src/patches/platforms/{claude,codex}/confirmation-hooks/`。
- Skill-Garden 协议作者源：`vendor/skill-garden/.trellis/0.6/scripts/confirmation.md`，策略作者源为相邻 `confirmation_policy.py`。
- `enhancements/0.6/` 为同步快照；项目 `.trellis/scripts/` 与平台配置属于 Plugin 部署产物。
- 专项测试：`test_confirmation_origin.py`、`test_confirmation_native.py`、`test_project_confirmation.py`、`test_confirmation_store.py`、`test_confirmation_windows.py`、`test_flower_confirmation_hook.py`；安装专项为 `test/js/confirmation-install.test.js`。
- 统一 Python 入口支持传入上述模块：`node scripts/run-python-tests.mjs test_confirmation_origin ...`。
- 共享运行时变更最终运行 `npm test`，并按 `quality-guidelines.md` 收集与提交匹配的 Ubuntu/Windows、Python 3.8/3.12 CI 证据和实际原生宿主验证。

## 与现有任务的边界

现有 `11-11-confirmation-capacity` 与 `11-11-confirmation-windows-native` 跟踪容量和 Windows 支持。本任务单独拥有输入事件、当前回合与自动确认基线契约。实施基于当前源码整合，保留这些任务已建立的容量、窗口及跨平台行为。
