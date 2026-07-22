# Brief — 修复复杂 BUG 修复意图误判为直接改动

## Goal

- 让意图路由区分“授权修复”和“授权跳过任务规划”，避免在 inspect 后因“改一下”“修第 1 个”等方案确认把复杂 BUG 误判为 `direct_edit`。

## Scope

- 在 workflow hub 中定义未知范围 BUG 的两阶段路由：先只读检查，范围明确后按 scope、risk 和 side effects 重新分类。
- 明确复杂实现信号，包括权限/数据范围、共享服务、跨包或跨层、多入口一致性、数据库/配置、历史回归和系统性测试。
- 保留局部低风险修复走 `direct_edit` 的能力。
- 保留明确“直接做/不要任务”的当前请求覆盖能力，但禁止从“改一下/修一下”等普通修复措辞推断覆盖。
- 从 `vendor/skill-garden/.trellis/0.6` 源 Patch 修改，经 `npm run sync` 更新 `enhancements/0.6`，并同步当前 dogfood workflow。
- 更新 Patch apply、精细安装、真实 catalog preflight、幂等与 AI context budget 相关验证。

## Non-Goals

- 不实现关键词或文件数量驱动的确定性分类器。
- 原则上不修改 `task_intent.py` 的创建、discard 和 Git baseline 行为。
- 不读取、修改、中断或提交 `~/project/srm` 正在运行的会话和业务代码。
- 不改变 active task scope guard、Phase 2 route 或 Trellis Push 语义。

## Key Context

- 已确认复现场景：`srm` 会话先正确进入 `inspect`，用户选择修复第 1 个问题后，Agent 错误声明“不创建 Trellis 任务”，实际改动扩展到公共权限服务、插件服务、两套 DAO、依赖和测试。
- `task_intent.py` 只执行任务创建与安全 discard，自然语言分类由 AI-facing workflow 规则承担。
- workflow hub 是权威语义层；Request Triage 和 `workflow-state:no_task` 只保留短门禁，避免高频上下文重复。
- 发布源必须先改 vendor，再生成 snapshot；只改 `enhancements/0.6` 会被后续 sync 覆盖。
- workflow 改动必须运行默认与 strict AI context budget，不通过提高阈值掩盖文本增长。

## Acceptance

- 最终 workflow 明确修复授权不等于跳过任务规划授权，并要求未知范围 BUG 在 inspect 后重新分类。
- “改一下/修第 1 个”不会被当作“直接做/不要任务”，但明确流程覆盖仍然有效。
- 复杂实现信号可执行且不会把全部 BUG 机械升级为 task。
- vendor、snapshot 和 dogfood 规则一致，精细安装 Bundle 完整且重复应用幂等。
- `npm test`、真实 Patch 预检及默认/strict AI context budget 通过且未越过 review ceiling。

## Next Step

- 用户确认本 brief 后运行 `task.py start`，再通过 `trellis-route(target=implement)` 选择实现执行方式。
