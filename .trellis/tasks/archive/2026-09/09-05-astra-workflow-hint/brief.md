# Brief — 为 gpt-6-astra 增加模型专用的工作流遵循提示

## Goal

- 用简短英文提示改善 Astra 的工作流、模板及证据陈述遵循，并验证实际效果。

## Scope

- 仅复用 Codex SessionStart 的 startup / clear / compact，在 state 分段追加一次。
- 完成独立开关、冲突核对、正常安装、工程回归及六场景共 60 次行为对照。

## Non-Goals

- 不修改 UserPromptSubmit、beginner-usage-guide、其他模型策略；不增加强制拦截或发布。

## Key Decisions

- 精确匹配事件输入 model=gpt-6-astra；其他模型、缺失值、别名不追加。
- 英文正文单一来源，完整块不超过 2048 UTF-8 字节；codex.astra_workflow_hint=false 独立关闭后续注入。
- 普通轮次和模型切换不立即刷新；保留全局禁用、resume、非交互及 no-trellis 原有语义。

## Key Context

- 源为 src/assets/flower_session_start.py，通过 Flower 正常资产投影分发。
- 三件套及 research 保存完整要求、官方契约与冲突依据；本次不涉及 Skill-Garden 源 Patch。

## Risks / Deferred

- Hook 不能删除历史指令或保证覆盖宿主限制；模型内部版本不可固定时明确记录。
- 提示可能无效或增加开销；注入成功不能作为行为改善的证据。

## Acceptance

- 模型、事件、分段、开关及异常路径正确，原上下文保留，正常安装和项目门禁通过。
- 记录真实宿主事件、接收及字节开销，不抬高既有预算。
- 六场景开关各 5 次，交付实际输出、工具证据与分项对照，未完成项如实标明。

## Next Step

- 实现与验证已完成；下一阶段由 trellis-update-spec 沉淀配置与预算契约。
