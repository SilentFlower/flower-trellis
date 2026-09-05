# Brief — SessionStart 分段注入

## Goal

完整交付启动摘要，取消 Codex resume 重复注入并保留显式额度。

## Scope

Codex / Claude 三个 handler、共享 Flower 分段脚本、受管平台 Patch、资产投影、预算和回归验证。

## Non-Goals

不改每轮状态与子代理规则，不改 old/0.5 注册行为，不承诺模型绝对遵循工作流。

## Key Decisions

复用原生生成器；state 独占会话绑定，rules / stages 只读；按语义边界拆分，彼此无执行顺序依赖；只匹配 startup / clear / compact。

## Key Context

src/assets、platform-patch-adapters、平台 catalog 和 builtin content-adapter；原始 5000 丢失证据已记录。

## Risks / Deferred

宿主真实模型接收若无法验证必须明确说明；超限和源接口变化需可见诊断。

## Acceptance

正文完整无重复，各段当前不超过 8000 字符；额度保留、重复生成幂等、绑定一次；通过安装投影与回归检查。

## Next Step

实现与 Check-All 已完成，先观察新会话的注入效果；收到继续后进入 Phase 3.3 规范沉淀。
