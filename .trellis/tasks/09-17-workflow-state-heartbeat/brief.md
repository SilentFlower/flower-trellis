# Brief — 优化 workflow-state 条件注入与低频心跳

## Goal

- 减少状态未变化时重复注入完整 `workflow-state` 的上下文开销，同时保证模型在状态切换、上下文重建和长对话中持续获得明确、可执行的当前动作。

## Scope

- Codex 与 Claude 在 `startup`、`clear`、`compact` 时无条件注入完整当前状态并重置心跳计数。
- Codex 与 Claude 的普通 `UserPromptSubmit` 只在完整状态发生变化时重新注入。
- 状态连续 5 次未变化时注入一次短心跳；心跳间隔通过 `prompt_injection.heartbeat_turns` 配置，`0` 表示关闭。
- 心跳携带当前 subject、可执行的一跳动作和最近完整规则指向；task 与 untracked 状态保留必要的 ID、status 或 summary。
- 用独立、会话隔离的 gitignored tracker 保存完整状态摘要与计数，并覆盖缺失、损坏和写入失败降级。
- 更新 Skill-Garden authoring source、Flower SessionStart asset、配置与运行契约、测试、snapshot、compiled targets 和当前 dogfood。

## Non-Goals

- 不重写各 workflow-state 的完整业务规则。
- 不改变 Trellis 状态机、任务创建、任务激活或阶段 owner。
- 不用心跳替代 SessionStart 的完整上下文恢复。
- 不改变 Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae、ZCode 等其他共享 Python Hook 平台的逐轮注入节奏。

## Key Decisions

- 本轮平台范围仅为 Codex 与 Claude；共享 Hook 文件继续保持字节一致，其他平台通过运行时分支保留现状。
- SessionStart 的 `state` 分段调用同一 workflow-state 渲染入口，直接附带完整状态并建立最新基线；普通轮次按完整 `additionalContext` 的 SHA-256 摘要识别刷新。
- 默认心跳周期为 5 次未变化输入，`no-trellis` 跳过轮次不读取、不写入且不累计计数。
- 心跳动作取自当前 `[workflow-state:*]` 正文的第一条非空、非 HTML 注释行，避免在 Hook 中维护第二套路由文案。
- tracker 单独存放在 `.trellis/.runtime/workflow-state/`，不写入 active task/untracked session JSON；记录文件名使用平台与 context key 的摘要并采用原子替换。
- 持久修改遵循 Skill-Garden source → `npm run sync` → compiled targets → Flower Plugin dogfood 的受管链路，不直接修改部署结果。

## Key Context

- workflow-state Hook authoring source：`vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/`。
- SessionStart authoring source：`src/assets/flower_session_start.py`；只有 `state` 分段承担 tracker 刷新副作用，`rules` 与 `stages` 继续独立并行。
- 完整状态规则继续以 `.trellis/workflow.md` 的 `[workflow-state:*]` 为权威来源。
- 配置沿用 `.trellis/config.yaml#prompt_injection`，新增 `heartbeat_turns`，缺省为 5。
- 现有 state 分段与最长 Codex `no_task` 上下文合计实测约 6921 字符，低于 8000 字符分段告警线；最终仍须按生成产物复测。
- 实现和检查上下文已在 `implement.jsonl`、`check.jsonl` 中登记 Patch Engine、Enhancements、AI Context Budget 和 Config/State 规范。

## Risks / Deferred

- SessionStart state 增长后可能接近宿主预算，必须测最终 `additionalContext`，不能以 Patch source 或估算代替。
- 共享 Hook 的平台识别或条件分支若泄漏到其他平台会改变既有行为，测试必须冻结至少一个非目标平台的连续逐轮输出。
- tracker 是可重建优化状态；任何读取、解析或写入异常必须回退完整注入，不能影响 active task 或 untracked runtime。

## Acceptance

- 新会话启动、清空或压缩后收到完整当前状态，紧随其后的未变化输入不重复完整正文。
- 状态变化后的下一次输入立即收到新的完整状态并重置计数。
- 前 4 次未变化输入保持静默，第 5 次只输出带可执行动作的短心跳，第 6 次重新计数。
- `no-trellis` 不计入心跳周期；关闭心跳后仍保留状态变化与 SessionStart 完整刷新。
- 多会话 tracker 互不影响，缺失或损坏时完整注入并安全重建。
- 其他共享 Python Hook 平台保持逐轮完整注入。
- vendor source、snapshot、compiled targets、Codex/Claude dogfood 与 Plugin provenance 一致，相关 Hook、Patch、上下文预算和完整测试通过。

## Next Step

- Brief 经确认后运行 `python3 ./.trellis/scripts/task.py start 09-17-workflow-state-heartbeat`，随后通过 `trellis-route(target=implement)` 进入实现。
