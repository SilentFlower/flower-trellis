# Codex / Claude SessionStart 分段注入与额度保留

## Goal

将 Codex、Claude 的启动摘要拆成三个独立 handler，避免单份过长被宿主转成预览；Codex 取消 resume 重复注入，并保留已设置的 additionalContextLimit。用户已在完整 brief 展示和暂停后回复“那你先继续，我们先看看效果”，确认恢复本任务实现；范围不变。

## Requirements

- R1：会话状态、工作流规则、阶段与路由分别注入，复用现有生成器和同一 workflow.md，不维护重复规则。
- R2：Codex 的匹配事件改为 startup、clear、compact；Claude 保持这些既有事件，不新增 resume。Flower 更新检查仍只在 startup 执行。
- R3：三份输出语义完整、顺序无依赖；会话绑定等写入只在状态部分执行一次。
- R4：迁移原有单 handler，并保留合法的 Codex additionalContextLimit，包括 5000、其他正整数和 0；分段后单独设置的额度再次应用仍保留。无值时保留宿主缺省行为。
- R5：在实际 Flower 安装 / Patch 生成链上生效，重复应用幂等、没有旧 handler 残留，不影响无关配置。
- R6：按最终分段输出测量长度并验证完整性；超限、缺失源和解析失败必须给出可见诊断，不能静默丢规则。

## Acceptance Criteria

- [ ] AC1：两个平台分别生成 state、rules、stages 三个 handler，Codex 不匹配 resume，更新检查只匹配 startup。
- [ ] AC2：拼合三个分段的正文与原始启动输出等价，关键路由与门禁完整且不重复；各分段当前不超过 8000 字符，另核对 Codex 的单 handler 额度。
- [ ] AC3：并行执行不依赖顺序；只有 state 执行原生主入口和会话绑定。
- [ ] AC4：原始 5000、其他合法额度及 0 经真实 Patch 应用后保留，分段独立额度不被其他分段覆盖；再次应用零差异。
- [ ] AC5：覆盖缺少 / 损坏源、禁用 hook、分段超限等异常，错误可见且不错误宣称完整注入。
- [ ] AC6：源资产、Plugin 投影、平台配置、预算测量和当前项目生成结果同步；完成针对性回归、全量检查、隔离目标安装与更新验证。

## Non-Goals

不修改每轮 workflow-state、子代理注入预算、目录 20 文件上限或任务路由语义；不宣称上下文完整交付能保证模型永远遵循工作流；不修改 old/0.5 的平台注册行为。

## Evidence

原始额度丢失见 research/reproduction.md。现有启动输出约 13.7 KB，工作流规则约 6600 字符，阶段与路由约 5100 字符，会话状态约 2000 字符。Claude 每份 additionalContext 超过 10000 字符会落盘，Codex 按 handler 独立限额。相关维护位置是 src/lib/platform-patch-adapters.js、src/patches/platforms/、src/assets/ 和 src/builtin-plugins/skill-garden/content-adapter.js。
