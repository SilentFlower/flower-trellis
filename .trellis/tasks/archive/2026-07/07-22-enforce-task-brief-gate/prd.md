# 修复 Trellis brief 确认门禁绕过

## Goal

修复复杂任务在同一 AI 回合内完成 `task.py create`、规划产物写入和 `task.py start` 时，可以绕过 `brief.md` 展示与用户确认的问题，使 Phase 1.4 的 planning review 成为可发现、可验证且默认失败关闭的门禁。

## Background

- 2026-07-22 在 `/root/project/srm` 的 Codex 会话 `019f8842-96ae-78a3-9445-91eea0541e3f` 中，任务意图被正确识别为复杂跨层修复。
- 会话在同一回合内于 14:11 创建 planning task，14:13 写入 `prd.md`、`design.md`、`implement.md`，随后直接运行 `task.py start` 并进入实现。
- 该任务没有生成 `brief.md`，最终 planning artifacts 也没有在对话中展示给用户确认。
- `workflow-state:planning` 和 `trellis-task-brief` 已明确要求展示 brief 并等待确认，但 planning 状态只会在下一次用户输入时注入；同一回合跨状态时不会自动获得该 breadcrumb。
- `get_context.py --mode phase --step 1.4` 当前只返回笼统的 “After artifact review”，没有明确调用 `trellis-task-brief`、展示正文并停止当前回合。
- `trellis-brainstorm` 当前只要求用户已 review 或明确批准继续，没有把收尾动作显式交给 `trellis-task-brief`。
- `task.py start` 当前不检查 `brief.md` 是否存在或是否晚于权威 planning artifacts，因此提示词门禁失效后会直接放行。
- `srm` 与 `flower-trellis` 当前的 workflow、brainstorm skill、task-brief skill 和 `task.py` 内容一致，问题属于公共流程设计缺口，不是单项目版本漂移。

## Requirements

- Phase 1.4 的按需上下文必须自包含 brief handoff：刷新 `brief.md`、在对话中展示完整正文、等待用户确认，确认前禁止运行 `task.py start`。
- `trellis-brainstorm` 完成 PRD convergence 和 planning quality bar 后，必须显式转交 `trellis-task-brief`，不能把早于最终规划产物的实现意向视为 planning review。
- SessionStart/Phase summary 的高频最小上下文必须保留一条不可误读的 brief 确认门禁，不能只依赖下一回合才注入的 `workflow-state:planning`。
- `task.py start` 在任务仍为 `planning` 时必须对缺失或过期的 `brief.md` 默认失败关闭，并输出可执行的恢复指引。
- brief 新鲜度以 `prd.md`、存在时的 `design.md`、存在时的 `implement.md` 为权威输入；任一权威产物晚于 `brief.md` 时视为过期。
- 保持 `brief.md` 为派生交接视图，不把需求或设计事实迁移到 brief 作为唯一来源。
- 修改必须落在 `vendor/skill-garden` 的真实源，并通过 `npm run sync` 更新 `enhancements/` 快照和当前 dogfood 副本；禁止只修改 `.trellis/` 运行副本。
- 保持 Trellis 0.6 Patch Engine 的幂等、全量预检、首次备份、精细安装和 JS/Python consumer parity 契约。
- 为同一回合 create → plan → start、缺失 brief、过期 brief、有效 brief 和重复应用补充自动化回归覆盖。
- 运行 Patch、Python、AI context budget 和完整 `npm test` 验证；不得通过提高预算阈值掩盖重复上下文。

## Acceptance Criteria

- [ ] `get_context.py --mode phase --step 1.4` 的最终输出明确要求调用 `trellis-task-brief`、展示完整 brief、等待用户确认，并明确当前回合停止在确认点。
- [ ] `trellis-brainstorm` 的最终 skill 正文明确把 planning-ready 状态转交 `trellis-task-brief`，且早期“按这个方案改”不能替代最终 planning artifacts/brief review。
- [ ] 从 `no_task` 上下文开始的复杂任务，即使 AI 尝试在同一回合直接执行 `task.py start`，缺失 brief 时命令也返回非零且任务保持 `planning`，且不运行 `after_start` hook。
- [ ] `brief.md` 早于任一权威 planning artifact 时，`task.py start` 返回非零并提示刷新 brief。
- [ ] brief 存在且不早于权威 planning artifacts 时，用户确认后的正常 `task.py start` 仍可进入 `in_progress`。
- [ ] 已经 `in_progress` 的历史任务可继续通过 `task.py start` 重新绑定活动任务，即使其没有 brief；workflow 仍按现有规则提示回补。
- [ ] auto-loop 的 `refresh_brief → start_task` 路径继续可用，不产生重复或相互矛盾的门禁。
- [ ] Skill-Garden 源、Flower 快照和 dogfood 最终文件一致，重复同步/应用不产生额外 diff。
- [ ] Patch conflict 检查、相关 Python 单测、AI context budget 默认与 strict 检查、`npm test` 全部通过；warning 如有必须记录原因。

## Out Of Scope

- 不回滚或修改 `/root/project/srm` 当前正在执行的业务任务。
- 不改变复杂任务的意图分类、自动创建 planning task 或 implement/check route 选择。
- 不把 `brief.md` 升级为新的权威规划文件。
- 不修改 `@mindfoldhq/trellis` 上游 npm 包源码；本任务通过 Flower/Skill-Garden 的 0.6 强化层实现。
- 不尝试从技术上证明确认消息一定来自真人，也不新增 planning review token、确认参数或独立 review 状态。

## Decision

- `task.py start` 只硬校验 `brief.md` 存在且不早于权威 planning artifacts。
- 用户确认仍由 workflow、`trellis-brainstorm` 和 `trellis-task-brief` 的对话门禁负责；脚本硬门禁只承担可确定验证，避免引入无法证明真人确认的伪安全状态。
