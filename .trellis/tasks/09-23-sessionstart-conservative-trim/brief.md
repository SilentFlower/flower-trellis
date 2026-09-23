# Brief — 保守精简 SessionStart 开场注入并保留流程约束

## Goal

- 在不削弱 Trellis 关键流程约束和运行行为的前提下，减少 SessionStart 常驻上下文中的重复及当前平台无关说明。

## Scope

- 删除原生 SessionStart `<ready>` 重复块和 Guardrails 中重复的 PRD-only 说明，保留状态、读取入口与完整规划产物契约。
- 将 Phase 1.3 改为平台无关的行为句，并在 SessionStart 摘要生成层按已识别平台裁剪派发说明；保留共同任务前缀、`trellis-route` 和平台特有调用契约。
- 移除步骤 3.1 的常驻历史解释，保持阶段编号、顺序和详情加载入口不变。
- 将更新确认的处理顺序移入真实更新事件的动态上下文；无更新时不注入该流程，成功后仍进入 `trellis-push`。
- 从 Hub 常驻摘要移除三天 GC 机制介绍，只保留实际迁移、GC、延后或异常结果；GC 行为本身不变。
- 刷新 Skill-Garden compiled targets、Flower 快照和 dogfood 投影，并完成结构、事件、平台、生成链和上下文预算验证。

## Non-Goals

- 不整体重写 workflow，不删除完整 owner 表、关键门禁、Astra 提示、workflow-state、心跳或 `state / rules / stages` 分段。
- 不改变任务 Close/GC、auto-loop、路由模式选择、更新授权或 Git 提交行为。
- 不通过提高预算、静默截断正文或新增每轮注入掩盖问题。
- 不执行 npm 发布或打 tag；未经后续确认不提交、不推送。

## Key Decisions

- 平台裁剪由原生 SessionStart 摘要生成层负责：Codex 使用固定平台标识，共享 Hook 复用现有 `_detect_platform()`；未知平台保留完整原文，失败关闭而不是丢规则。
- 共同派发协议始终覆盖全部子代理和 `trellis-research`；Codex 保留 `SubagentStart` 注入与 child-side pull fallback。
- Grok/Kimi 不走该 SessionStart Hook，其 `spawn_subagent`、内置 `coder` / `explore` 要求继续由 `trellis-route` 平台配置和各自入口持有并测试。
- Hub 继续保留 `Flower Update Confirmation` 与 `Deferred Physical GC` owner 行，只删除不必常驻的机制句；动态 owner 承担事件细节。
- 1,089 B 是估算而非硬指标；交付以最终生成内容、真实预算和行为回归为准。

## Key Context

- 当前重构后基线：SessionStart 最大场景 19,177 B；Codex state/rules/stages 为 7,081 / 7,060 / 5,036 B，Claude 为 4,682 / 7,060 / 5,036 B，控制面合计 108,611 B。
- 关键作者源包括 Skill-Garden workflow/Hook Patch、`src/assets/flower_session_start.py`、`src/assets/flower_update_hook.py` 和 `src/commands/self-update.js`。
- `### Planning Artifacts` 是 Flower 分段边界，必须保持；canonical、compiled targets、`enhancements/0.6` 与 dogfood 最终内容必须一致。
- `09-22-task-close-archive-gc-refactor` 与 `09-20-auto-loop-in-progress-baseline` 已完成并推送，本任务不再处于延期状态。

## Risks / Deferred

- 原生 Codex Hook与共享多平台 Hook结构不同，Patch 必须分别用唯一 selector 和 baseline 锁定，避免上游变化时误删内容。
- 规则存在、Hook 注入成功和单次模型遵循不是同一层证据；确定性结构/入口测试与真实模型对话结果必须分开记录，后者不作统计性保证。

## Acceptance

- 实际开场输出不再含选定重复内容，状态、产物要求、阶段导航、规范发现与详情加载入口仍完整。
- Codex、Claude 和共享已识别平台只收到适用派发说明；未知平台完整回退，Grok/Kimi 调用契约仍可验证。
- 无更新、确认、暂缓/跳过、更新成功四类路径保持正确顺序和授权边界；成功后继续进入 `trellis-push`。
- GC startup/resume、三天阈值、精确提交和恢复行为不变；无动作静默，动作、延后和错误仍报告。
- owner 表、Request Triage、规划/实施授权、检查停止、提交、auto-loop、父子任务、Astra、workflow-state、心跳和分段契约无意外删改。
- 在同一最终代码上报告修改前后各平台与事件场景的真实字节数，不调整预算阈值；默认与 strict 检查通过。
- Skill-Garden 作者源、compiled targets、Flower 快照、隔离安装和 dogfood 一致，相关定向测试、完整测试及幂等验证通过。

## Next Step

- 用户确认本 Brief 后运行 `task.py start`，再进入 `trellis-route(target=implement)` 开始实现。
