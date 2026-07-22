# 修复复杂 BUG 修复意图误判为直接改动

## Goal

让任务意图自动识别正确区分“授权修复”和“授权跳过任务记录”：用户确认要修复某个 BUG 时，系统可以继续推进，但必须根据已经查明的范围、风险和影响面重新判断 `direct_edit` 或 `task_plan`，不能因为“改一下”“修一下”等短句直接绕过复杂任务规划。

## Background

- `srm` 实际会话先收到“再看下这个是啥问题”，正确进入只读 `inspect`。
- 排查结果已经确认新询价模块的数据范围接入涉及公共权限服务、插件服务、两套 DAO、依赖配置和回归测试。
- 用户随后回复“我觉得 1 改一下吧”，这是对修复对象的确认，不是“直接做”或“不要任务”的流程切换。
- Agent 却声明按 `direct_edit` 执行、不创建 Trellis 任务，最终修改 6 个文件并运行跨模块编译测试。
- 当前意图路由只要求模型综合 scope、risk 和 side effects，但没有明确说明：修复授权不等于跳过任务授权，且未知范围的 BUG 应先检查、再重新分类。
- `task_intent.py` 只负责任务创建与安全丢弃，不承担语义分类；本次修复应落在 AI-facing workflow Patch 和对应回归门禁。

## Requirements

- R1：意图路由必须把“是否允许修改”和“是否需要任务规划”视为两个独立判断维度。
- R2：`查/看看/分析` 等诊断请求保持 `inspect`，未获得修复授权前禁止编辑业务文件。
- R3：`查并修/修复/改一下` 等表达可以授权修复，但在范围未知时先执行只读检查；范围明确后必须基于实际影响重新分类。
- R4：用户在 inspect 结论后选择“修第 1 个”“这个改一下”等方案确认，不得单独视为 `直接做/不要任务` 风格的显式 `direct_edit` 切换。
- R5：涉及权限、数据范围、共享服务、跨包或跨层调用、多入口一致性、数据库/配置、历史回归，或需要系统性回归测试时，应视为复杂实现信号并进入 `task_plan`。
- R6：`direct_edit` 仅用于范围明确、局部、低风险、可逆且验收方式简单的改动；不能只按用户消息长度或“遗漏”“小改”等措辞判断。
- R7：复杂修复一旦命中 `task_plan`，只授权创建 planning task 并进入 `trellis-brainstorm`，不得越过 brief、start 和 route 门禁。
- R8：保留用户对当前请求的显式流程覆盖能力；只有明确的“直接做”“不要任务”等指令才可覆盖自动 `task_plan`，不得从普通修复措辞或方案选择中推断该覆盖。
- R9：权威语义放在 workflow hub；`no_task` state 和 Request Triage 仅保留执行当前判断所需的短门禁，避免高频上下文重复膨胀。
- R10：修改必须从 `vendor/skill-garden/.trellis/0.6` 源 Patch 开始，通过 `npm run sync` 同步 `enhancements/0.6`，并同步当前 dogfood 最终文件。
- R11：不得读取、修改或中断 `~/project/srm` 正在运行的会话和工作区；该会话仅作为已确认的行为证据。

## Acceptance Criteria

- [x] AC1：最终 workflow 明确写出“修复授权不等于跳过任务规划授权”。
- [x] AC2：最终 workflow 明确要求未知范围 BUG 先 inspect，再按查明的 scope/risk 重新分类。
- [x] AC3：最终 workflow 明确说明“改一下/修第 1 个”不等于 `直接做/不要任务` 式显式切换。
- [x] AC4：最终 workflow 包含可执行的复杂实现信号，并覆盖权限/数据范围、共享服务、跨层或多入口、数据库/配置、系统性测试。
- [x] AC5：最终 workflow 保留小型、局部、低风险修复走 `direct_edit` 的能力，不把所有 BUG 机械升级为任务。
- [x] AC6：最终 workflow 保留明确“直接做/不要任务”的当前请求覆盖能力，同时不会把“改一下/修一下”误识别为该覆盖。
- [x] AC7：Patch apply 测试断言上述关键语义存在，且 `task-intent` / `intent-routing` 精细安装仍包含完整 Bundle、保持幂等。
- [x] AC8：vendor overrides 与 `enhancements/0.6` 发布快照同步一致，当前 dogfood workflow 体现新规则。
- [x] AC9：`npm test`、Patch 预检、默认与 strict AI context budget 检查通过；新增高频文本没有越过 review ceiling。
- [x] AC10：重复应用强化包不会重复注入或产生额外文件变更。

## Out Of Scope

- 不实现基于关键词或文件数量的独立确定性分类器。
- 不修改 `task_intent.py` 的创建、discard 或 Git baseline 行为，除非实施阶段发现新规则无法由现有 helper 承载。
- 不修复或提交 `srm` 会话中的业务代码。
- 不改变 active task scope guard、Phase 2 route 或 Trellis Push 的既有语义。

## Notes

- 本任务属于复杂工作流行为修复，需要 `design.md`、`implement.md` 和真实 JSONL 上下文清单后才能进入 start review。
