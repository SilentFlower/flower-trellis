# Implementation

此前误将方案方向同意视为 brief 确认，提前写入分段脚本、Adapter / Patch、资产投影和针对性测试后暂停并退回 planning。完整 brief 展示后，用户回复“那你先继续，我们先看看效果”，现按已确认范围恢复执行。

- [x] 增加共享分段脚本，覆盖原生输出等价性、异常、禁用标志和一次性副作用。
- [x] 扩展 Flower 平台 Patch 与 Adapter，迁移原单 handler、保留额度、删除 resume 匹配并验证幂等。
- [x] 同步 Flower 资产投影、预算 checker 与相关事实规范。
- [x] 在隔离目标验证实际安装、生成配置的三个 handler 和更新幂等；用受管生命周期更新 dogfood。
- [x] 运行 node --test test/js/platform-patches.test.js test/js/ai-context-budget.test.js 和 Python 分段回归。
- [x] 运行 npm test、修改模块语法检查及默认 / strict 预算检查；执行 Check-All。

## Review

2026-09-05：Check-All inline / full 通过源码与安装链检查，未发现剩余 CHK / FBK。npm test 通过 519 个 JavaScript 测试和 318 个 Python 测试；Patch 冲突、compiled targets、输出模板、默认与 strict 预算通过。已有 states-total 告警为 13119 bytes，低于 14336 bytes review ceiling，本任务未修改这些状态正文。

真实隔离目标 init / update / uninstall dry-run 通过；分段后自设 [5000, 6000, 0] 经实际 update 保留。当前项目通过受管 update 安装分段脚本和两端配置，再次 dry-run 目标变化 0 项；外部 Plugin 声明、lock、state 和文件摘要均不变。详情及验收映射见 check-report.md。

下一步：用户先观察新会话注入效果；收到继续后进入 Phase 3.3 规范沉淀。尚未提交或推送。

## Validation Limits

宿主实际模型请求的接收证据需使用宿主可用的只读日志或不产生额外模型费用的验证入口。若环境无法证明实际模型接收，则明确报告为未验证，不把 Python 输出等价性冒充真实模型接收。
