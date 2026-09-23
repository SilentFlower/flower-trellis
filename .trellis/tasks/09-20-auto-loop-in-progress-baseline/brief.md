# Brief — 修复 auto-loop 在途任务基线

## Goal

- 修复合法决策被误判为文档漂移的问题，恢复 Workflow V3 内核原运行。

## Scope

- 补齐 in_progress 任务首次接管的摘要初始化。
- 通过原 action、pending 与决策日志恢复旧运行遗漏的摘要，增加正反例回归。
- 修改 Skill-Garden 作者源、同步快照，经 Plugin 生命周期应用到当前项目。

## Non-Goals

- 不手写真实 runtime，不放宽漂移与权限检查，不 push、发布或归档。

## Key Decisions

- 复用已有证据恢复，保留原 action 和 pending；真实 record 才消费决策。
- 终态仍由显式 retry-blocked 恢复；不新建 run 绕过失败。

## Key Context

- 作者源在 flower-trellis/vendor/skill-garden；原运行 auto-20260920002543 的两项摘要为空，其余证据一致。

## Risks / Deferred

- 本地验证不替代 Windows/Python 3.8 CI；远程矩阵未执行前不宣称兼容验收完成。

## Acceptance

- 新接管与旧运行恢复的真实 CLI 回归通过，证据不足或越界漂移继续拒绝。
- 源码、快照、安装一致，第二次应用零修改，原内核改动保留并恢复原 action。

## Next Step

- 添加能复现误阻断的隔离 CLI 测试。
