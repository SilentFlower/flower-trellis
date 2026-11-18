# 放宽后台确认的恢复输入与任务绑定限制

## Goal

让后台确认在 Codex 服务恢复及任务绑定差异场景下继续工作，并修正跨平台环境变量导致的会话身份误选。

## Background & Decisions

- 用户先报告 `daemon_recovery` 续跑后的 `Codex 缺少可核验的当前回合输入`，随后报告 `确认材料与当前会话任务不符`，并明确要求开放两处限制。
- 恢复准入的现状证据位于 `.trellis/scripts/flower_confirmation_runtime/codex.py:199`；用户期望恢复回合仍能进入自动确认。
- 任务相等校验位于 `vendor/skill-garden/.trellis/0.6/scripts/confirmation_policy.py:354`；用户明确要求移除。
- 身份误选入口位于 `.trellis/scripts/common/active_task.py:70`、`:348`、`:529`；用户指出列表优先选择存在问题，本轮纳入根因修复。
- 两个现场的时间、原生标识、实际解析结果和所有权证据统一保存在 `research/confirmed-causes.md`。

## Requirements

- R1：支持 Codex 原生恢复回合准备自动确认；使用可核验的原生恢复关系衔接原始用户输入及当前展示回合。
- R2：移除确认材料任务与当前会话任务必须相等的准入校验；材料中的任务声明决定本次确认的任务范围。
- R3：修正默认会话身份解析，使 Codex shell 同时携带继承的 Claude 标识时仍使用当前 Codex 身份；显式平台或上下文身份保持原有优先语义。
- R4：维持完整展示后计时、后续用户输入作废、材料变化作废、原窗口归属以及单次领取和 started 的原有执行约束。

## Acceptance Criteria

- [x] A1（R1）：原始用户输入后的原生恢复回合可完成 prepare、完整展示、等待、领取和 started。
- [x] A2（R2）：Check/Push 材料声明任务而会话绑定为空或不同任务时，可以按声明任务准备确认；Brief 同样允许显式目标与现有绑定不同。
- [x] A3（R3）：Codex 与 Claude 会话标识共存时，任务激活、查询和确认对当前 Codex 会话身份保持一致。
- [x] A4（R1、R2、R4）：恢复链、后续新输入、材料和会话状态变化的行为由针对性回归覆盖；重复领取和重复 started 仍被拒绝。
- [x] A5（R1—R4）：源、发布快照、编译 Patch 及 dogfood 输出保持一致，受影响 Ubuntu/Windows 验证覆盖齐备。

## Non-Goals

- 软件发版及给截图中的业务项目执行升级。
- 自动修复截图业务项目的 Check-All findings。
- 扩大自动确认对生产、宿主审批或新产品决定的授权范围。
