# Brief — 修复 Trellis brief 确认门禁绕过

## Goal

- 修复复杂任务可在同一 AI 回合内绕过 `brief.md` 展示与用户确认并直接进入实现的问题，使 Phase 1.4 planning review 可发现、可验证且默认失败关闭。

## Scope

- 前移并收紧 Workflow Hub 的 Task Brief Handoff，让 SessionStart/Phase summary 优先保留关键门禁。
- 为 Phase 1.4 增加自包含的 `trellis-task-brief → 展示完整 brief → 停止等待确认 → 后续才 start` 流程。
- 为 `trellis-brainstorm` 增加 Planning Handoff，明确早期实现意向不能替代最终 planning review。
- 通过 Trellis 0.6 File Patch 为 `task.py start` 增加 planning task 的 brief 缺失/过期校验，且在任何状态、活动指针和 hook 副作用前失败关闭。
- 更新 intent-routing Bundle、conflicts 断言、JS/Python Patch 测试、task start runtime 测试。
- 从 `vendor/skill-garden` 同步 `enhancements/0.6` 并应用到当前 dogfood 副本，运行完整质量与上下文预算验证。

## Non-Goals

- 不回滚或修改 `/root/project/srm` 当前业务任务。
- 不改变任务意图分类、自动创建 planning task 或 implement/check route。
- 不把 brief 升级为权威规划文件。
- 不修改 `@mindfoldhq/trellis` 上游 npm 包源码。
- 不新增 planning review token、确认参数或独立 review 状态，也不尝试技术证明真人确认。

## Key Context

- 根因是同一回合内 `no_task → planning → in_progress` 不会触发新的 planning breadcrumb，而 Phase 1.4 按需正文与 `task.py start` 都缺少闭合门禁。
- 硬门禁只作用于 `status=planning` 的首次启动；已经 `in_progress` 的历史任务仍可无 brief 重新绑定。
- brief 新鲜度以 `prd.md`、存在时的 `design.md` 和 `implement.md` 的 `st_mtime_ns` 为准；任一权威产物更新后未刷新 brief 即阻断 start。
- 校验失败不修改 task 状态、不调用 `set_active_task`、不运行 `after_start` hook；`task.py create` 已建立的 planning pointer 保持不变。
- 真实修改源是 `vendor/skill-garden/.trellis/0.6`，必须同步快照和 dogfood，遵守 Patch Engine 幂等、全量预检与 consumer parity。
- auto-loop 已有 `refresh_brief → start_task` 路径，应与新 guard 保持兼容。

## Acceptance

- Phase 1.4 和 brainstorm 最终输出均明确调用 task-brief、展示完整摘要并等待用户确认。
- 同一回合直接 start 时，缺失/过期 brief 返回非零，任务保持 planning，hook 不执行。
- fresh brief 可正常进入 in_progress；历史 in_progress 无 brief 可正常重新绑定。
- Skill-Garden 源、Flower 快照、dogfood 最终文件一致且重复应用无额外 diff。
- Patch conflict、Python/JS 单测、AI context budget 默认与 strict、`npm test`、`git diff --check` 全部通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `task.py start`，随后进入 `trellis-route(target=implement)`；实现按 vendor 源 → snapshot → dogfood → tests 的顺序推进。
