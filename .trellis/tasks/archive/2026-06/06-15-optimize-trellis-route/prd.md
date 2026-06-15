# brainstorm: optimize trellis-route

## Goal

优化 `trellis-route` 的交互体验，减少实现和检查阶段反复弹出模式选择带来的打断感，同时保留 Trellis 对实现方式、检查强度和提交前质量门的可控性。

## Background / Known Context

- 用户反馈：当前 `trellis-route` 的交互“总是有点麻烦”。
- 当前 `trellis-route` 在 implement 阶段提供 4 个选项，其中选项 3/4 可记住 4 小时会话偏好。
- 当前 check 阶段每次都必须询问 4 个选项：`check-all/check` 与 `inline/subagent` 的组合。
- `.trellis/workflow.md` 的 skill-garden override 明确要求：implement/check agent 或 check skill 运行前必须先经过 `trellis-route` 或同编号 fallback 选择。
- 当前规则刻意不让 check 使用 4 小时偏好，主要是避免累积偏好导致提交前漏跑 `check-all`。
- 本仓库存在多份需要保持一致的副本：`.agents/skills/trellis-route`、`.claude/skills/trellis-route`、`enhancements/0.6`、`vendor/skill-garden/.trellis/0.6`，并可能需要同步 `enhancements/MANIFEST.json`。

## Assumptions (temporary)

- 优化重点是减少低价值确认，而不是完全移除安全确认。
- MVP 优先改 0.6 版本和当前平台副本，不主动回改 0.5。
- 若改动 workflow override，需要同步源头 `vendor/skill-garden` 与生成快照。

## Decisions

- 轻量 `trellis-check` 保留隐藏逃生口：普通选项不显示，但用户明确输入 `light check` / `轻量检查` 时仍可走轻量检查。
- 持久化配置使用 gitignored 的个人本地文件；具体格式在设计阶段收敛，但不得进入提交计划。

## Requirements

- 减少 `trellis-route` 在常规开发流中的重复交互成本。
- 支持个人持久化路由配置；该配置属于开发者本地偏好，必须被 git ignore，不纳入版本库，避免多人开发互相影响。
- implement 与 check 都支持个人持久化路由配置。
- 正常路由时可以优先使用个人配置，减少重复选择。
- 个人配置只代表执行模式偏好，不能作为开始实现或开始检查的授权；任务仍必须先完成规划确认并进入 `in_progress`。
- 当用户表达“临时改一次”“重新选择”“这次不用默认/配置”等意图时，必须绕过已保存配置并重新展示选项，而不是让配置优先。
- 选项展示必须根据当前状态变化：无配置时展示“本次/保存为默认”等选择；已有配置且用户要求临时改时展示“仅本次覆盖/更新默认/清除默认”等选择。
- check 路由不再推荐轻量 `trellis-check`，普通选项中不显示 `check inline` / `check subagent`；check 入口默认收敛为 `check-all inline` / `check-all subagent` 及其持久化配置选项。
- 轻量 `trellis-check` 仅作为隐藏逃生口存在：用户明确说 `light check` / `轻量检查` 时可用，普通 route 选项不展示。
- 保留用户覆盖默认选择的能力。
- 保留提交前质量门，避免因为省交互而跳过必要的 `check-all`。
- 文档必须清楚描述自动选择、快速确认、会话偏好、失效/重置规则。
- `.agents`、`.claude`、`enhancements/0.6` 和 `vendor/skill-garden/.trellis/0.6` 中的 route 语义保持一致。

## Acceptance Criteria

- [x] implement 路由不再需要每次重复选择，且用户仍能覆盖 inline/subagent。
- [x] check 路由的交互比当前 4 选项更省事，且普通选项只展示 `check-all` 相关路径。
- [x] check 也能使用私有持久化配置，且不会把轻量 `trellis-check` 作为推荐或普通选项展示。
- [x] 用户明确请求轻量检查时，`trellis-route` 能输出轻量 `trellis-check` 路径。
- [x] 持久化偏好文件位于 gitignored 路径，且不会出现在提交计划中。
- [x] route 偏好不会绕过任务规划确认；任务未 start 或仍在等用户确认时不能直接进入实现。
- [x] 用户要求临时改/重选时，即使存在偏好文件，也会重新显示选项。
- [x] route 选项会随“无配置 / 命中配置 / 临时覆盖 / 更新默认”场景显示不同含义。
- [x] `trellis-route` 文档明确哪些情况可以自动执行、哪些情况必须问用户。
- [x] 修改后的副本一致，`npm run sync` 后快照一致。
- [x] 基础校验通过：语法检查、diff 空白检查；`node scripts/check-snapshot.mjs` 当前因 `enhancements/` 未提交而按预期失败，提交快照后应通过。

## Out of Scope

- 不新增 Trellis CLI 子命令或脚本级实现，优先通过 skill/workflow 文档收敛 agent 行为。
- 不改变 `trellis-push` 的提交确认门。
- 不移除用户手动选择 subagent / inline / check-all / check 的能力。

## Research References

- 暂无外部研究；本任务优先基于本仓库现有 `trellis-route` 与 workflow override 做本地设计。
