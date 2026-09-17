# 优化 workflow-state 条件注入与低频心跳

## Goal

减少 `UserPromptSubmit` 在状态未变化时重复注入完整 `workflow-state` 所产生的上下文开销，同时保证模型在状态切换、上下文重建和长对话中仍能获得明确、可执行的当前动作。

## Background

- 当前 Python `inject-workflow-state.py` 会在每次用户输入时注入完整状态正文。
- Codex 与 Claude 已在 `startup`、`clear`、`compact` 时通过分段 SessionStart Hook 重建会话上下文。
- 当前 Python workflow-state Hook 由 Skill-Garden 共享 Patch 投影到多个平台，项目内已部署文件不是持久修改入口。
- 心跳仅携带状态标签不足以稳定指导模型；心跳必须包含当前动作摘要并指向最近一次完整规则。

## Requirements

- `startup`、`clear`、`compact` 必须无条件重建当前完整状态，并将其作为后续条件注入的最新基线。
- `UserPromptSubmit` 检测到任务、阶段、untracked flow、相关 workflow-state 正文或 Codex dispatch mode 发生变化时，必须立即注入完整状态。
- 状态未变化时不得重复注入完整状态正文。
- 状态连续未变化达到配置的用户输入次数时，必须注入一次低频心跳并重新计数。
- 心跳必须包含当前状态、可执行的一跳动作，以及继续遵循最近完整 `workflow-state` 的明确指向；不得只输出自闭合引用标签。
- 心跳间隔必须可配置；配置为 `0` 时关闭心跳。
- 心跳默认间隔为 5 次状态未变化的用户输入。
- 条件注入、低频心跳和 SessionStart 基线同步仅覆盖 Codex 与 Claude；其他共享 Python Hook 平台保持现有逐轮完整注入行为。
- 状态记录必须按宿主会话隔离，不能在多个窗口、线程或平台之间串用。
- 状态记录缺失、损坏或无法安全解析时，必须降级为完整注入。
- 现有 `no-trellis` 单轮跳过语义必须保留；被跳过的轮次不读取、不写入且不累计心跳计数。
- 生成内容必须继续使用 `.trellis/workflow.md` 作为完整状态规则的权威来源。

## Out of Scope

- 重写各状态现有的完整业务规则。
- 改变 Trellis 的任务状态机、任务创建或任务激活流程。
- 以心跳替代 `startup`、`clear`、`compact` 的完整上下文恢复。
- 改变 Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae、ZCode 等其他共享 Python Hook 平台的注入节奏。

## Acceptance Criteria

- [ ] 新会话启动、清空或压缩后，模型收到当前完整状态，随后首个未变化的用户输入不会再次收到同一完整正文。
- [ ] 状态变化后的下一次用户输入会收到新的完整状态，且心跳计数重新开始。
- [ ] 连续未变化轮次未达到配置间隔时无 workflow-state 输出，达到间隔时只输出短心跳，随后重新计数。
- [ ] 心跳文本独立包含足以执行下一步的动作摘要，并引用最近一次完整规则。
- [ ] 会话 A 的计数、状态变化和损坏恢复不会影响会话 B。
- [ ] `no-trellis` 仍只跳过当前轮次且不计入心跳周期，后续状态变化能够正常完整注入。
- [ ] 心跳关闭时，状态未变化的用户输入保持静默，状态变化和 SessionStart 恢复仍正常工作。
- [ ] 缓存缺失或损坏时输出完整状态，并留下可继续运行的有效记录。
- [ ] 真实受管目标、发布快照与 dogfood 输出保持同步，相关 Hook 和上下文预算测试通过。

## Notes

- 规划任务目录：`.trellis/tasks/09-17-workflow-state-heartbeat`。
- 历史会话检索未发现相同设计决策。
