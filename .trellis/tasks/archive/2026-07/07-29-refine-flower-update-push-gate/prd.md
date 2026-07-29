# 优化 trellis-push 检查门禁与意图识别

## Goal

优化 flower-trellis / skill-garden 0.6 的 AI workflow 门禁体验，让用户发起 `trellis-push` / push / 提交时直接进入 push 计划，不因 Check-All 或 Update-Spec 状态增加新的确认卡点。

本任务合并两个问题：

1. `trellis-push` 曾在缺少有效 Check-All 时弹出 `运行 check-all` / `跳过检查并继续 push` 二选一。用户反馈这个多出的确认卡点不自然；Flower 自动更新只是暴露该问题的一个场景，不是根因。
2. 用户对门禁体验提出设计反馈时，AI 把它误判成可直接修复的 `direct_edit`，在没有创建/确认任务规划前改了 workflow/skill/self-update 相关文件。这个意图识别边界本身也需要优化。

目标不是取消正常开发收尾中的质量流程，也不是取消 Git 安全检查，而是让显式 Push 意图不再被完成链前置门禁二次拦截。Check-All 与 Update-Spec 状态进入 push 计划的审计信息；是否继续执行由 `trellis-push` 原本的 exact files、commit message、Git 安全预检和最终执行确认承载。

## Confirmed Facts

- 当前任务由用户显式要求创建，已完成 planning artifacts / brief review，并进入 `in_progress` 实现与检查阶段。
- 历史提交 `1bd0a12` 曾把 `.agents/skills/trellis-push/SKILL.md` 的 Step 0 改成 `运行 check-all` / `跳过检查并继续 push` 二选一；该部分已按用户要求回退并作为本任务实施基线。当前 Step 0 已重做为记录 Check-All / Update-Spec 完成链证据，不再因这些状态返回 Phase 2.2 或新增确认卡点。
- `.trellis/workflow.md` 的 owner index 规定：`Flower Update Confirmation` 由 SessionStart update context + Flower CLI 拥有，完成后的 update 返回 `trellis-push`；`Code Commit Confirmation Gate` 由 Phase 3.4 + `trellis-push` 拥有。
- `src/commands/self-update.js` 当前会输出 `<flower-update-result>`，包含 `post_action: run_trellis_push_confirmation`，用于提示 AI 进入 `trellis-push`，但不应自行执行 Git 提交。
- 项目规范要求 0.6 强化 skill 先改 `vendor/skill-garden/.trellis/0.6/` 源，再 `npm run sync` 同步到 `enhancements/0.6/`；workflow/skill/hook 规则必须保持单一 owner，不把完整规则复制到 hub/state/skill 多处。
- 上一轮过早 direct edit 产生的 Flower self-update 特例草稿已撤掉；用户要求先回退 `feat(0.6): 允许 Push 显式跳过 Check-All`，本任务随后基于精确回退基线重新实现了确认后的 Push 与意图识别方案。
- 用户最新澄清：大的问题不是更新有问题，而是 `trellis-push` skill 的体验；有时用户想 push 时确实不想经过 Check-All，但当前设计会多出现一次确认卡点。
- 用户进一步澄清：不能再增加卡点；普通 push 请求也不应因缺少 Check-All 停下来要求用户改写意图或重新确认。
- 用户确认：显式 Push 时，Check-All 与 Update-Spec 都不再作为前置门禁，只在同一次 push 计划中披露状态。
- 用户指出：workflow gate、hook、push/check-all 等影响面只能作为风险信号，不能仅凭影响面自动判定 `task_plan`；精确回退或范围已知、无需设计决策的修改仍可直接执行。

## Requirements

- R1: 重新设计 `trellis-push` 的完成链前置门禁：用户显式发起 push、提交或由 Flower 更新结果进入 push confirmation 时，直接进入 Git 预检与 push 计划，不因 Check-All 或 Update-Spec 状态增加额外停顿、澄清或二选一确认。
- R2: Push 计划必须清晰披露 Check-All 与 Update-Spec 的当前状态，包括未运行、已失效、已通过、存在 findings、`no-op`、`written` 或 `needs-review` 等可用事实，但这些质量状态不得阻止计划生成。只有 Git 冲突、范围不明确、仓库状态不满足 exact commit 等 Git 安全条件可以阻断。
- R3: 保持正常开发收尾链不变：由 workflow 推进的完成流程仍按 Check-All -> Update-Spec -> Push 执行；本任务只改变用户已经明确进入 Push 时的行为。
- R4: 优化 Request Triage 的授权判断：询问看法、表达不适或否定方案时进入 `discuss`；请求查明原因或核对现状时进入 `inspect`；明确要求执行一个范围已知、可逆、无需额外设计决策且可简单验证的修改时允许 `direct_edit` 或匹配的 `workflow_action`；只有范围、方案或副作用仍需规划时才进入 `task_plan`。
- R5: workflow gate、hook、push/check-all、跨平台 skill 等共享影响面是提高证据与验证要求的风险信号，不是自动判定 `task_plan` 的关键词规则，也不得替代对完整当前请求的判断。
- R6: 保持 owner 边界：自然语言意图归 Request Triage 判断；Push 计划与 Git 安全归 `trellis-push`；Check-All 和 Update-Spec 的正常执行仍归各自 owner；不要新增平行 Gate Engine 或把完整规则复制到多个高频上下文。
- R7: 若修改 0.6 skill 或 patch，必须先改 `vendor/skill-garden/.trellis/0.6/` 源，再同步 `enhancements/0.6/`，并按规范检查源/快照一致。
- R8: 覆盖回归测试：显式 Push 在 Check-All 或 Update-Spec 缺失、失效、失败或需复核时仍进入 push 计划；计划披露两类状态；正常完成链顺序不变；Request Intent routing 按授权与确定性分类；workflow gate owner 保持唯一。
- R9: 在最终实现前处理当前未确认草稿 diff：先列出哪些文件来自上一轮过早 direct edit，再根据本任务设计决定回退或重做。

## Acceptance Criteria

- [x] PRD 明确两个问题的目标、边界、需求和已确认决策。
- [x] 复杂任务规划产物完整：`design.md` 说明 owner、状态流、交互策略和兼容边界；`implement.md` 说明执行顺序、验证命令和回退点。
- [x] `trellis-push` 不再以“交互式完成链门禁”阻断显式 Push，也不再弹出 `运行 check-all` / `跳过检查并继续 push`，或要求用户改写成“直接 push，不跑 check-all”。
- [x] 用户发起 push 时，`trellis-push` 直接进入 Git 预检与计划；计划中必须展示 Check-All 状态、Update-Spec 状态、exact files 和 commit message，仍只需原有的最终执行确认。
- [x] 已知 Check-All findings/blocked 或 Update-Spec `needs-review` 作为计划风险披露，不新增第二次确认；Git 层面的确定性安全问题仍会阻断。
- [x] 正常 workflow 完成链仍保持 Check-All -> Update-Spec -> Push，不因显式 Push 分支而取消默认质量流程。
- [x] “你觉得怎么改”“这个方案不舒服/不认同”等表达不会被当作修改授权；“检查原因”进入 inspect；明确、范围已知且无需设计决策的修改或回退不会仅因涉及 workflow/hook 就被强制升级为任务规划。
- [x] 不绕过 `trellis-push` 的 exact files、commit message、Git 安全预检和最终确认；不允许 `self-update` 自行执行 git add/commit/push。
- [x] 0.6 源、发布快照、当前项目副本在最终需要时保持一致；未确认草稿 diff 得到明确处理。
- [x] 相关 JS 测试、Patch conflict / compiled target 检查和上下文预算检查按实现影响范围运行并记录结果。

## Out Of Scope

- 不做 release / publish。
- 不把 `self-update` 改成自动提交。
- 不新增一套独立 workflow gate runtime；优先使用现有 workflow / skill / helper / Patch Engine。

## Decisions

- D1: 普通 `push` / `提交` 请求本身足以进入 push 计划；不得再因 Check-All 缺失增加“运行 Check-All / 跳过 Check-All”二选一，也不得停下要求用户改写意图。
- D2: Check-All 与 Update-Spec 仍是正常开发收尾流程，但在显式 `trellis-push` 中都降级为计划审计信息，不是 push 计划生成门禁。
- D3: 先回退 `feat(0.6): 允许 Push 显式跳过 Check-All`；保留 `update -y` 修复，不回退 `.flower/` 状态，也不删除本任务规划文件。
- D4: 影响面是风险信号而不是意图分类结果；是否进入 `task_plan` 取决于修改授权、范围确定性、剩余设计决策、副作用和验证复杂度的整体判断。
