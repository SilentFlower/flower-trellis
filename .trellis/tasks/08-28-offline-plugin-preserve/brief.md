# Brief — 修复外部 Plugin 不可达时阻塞 Flower 升级

## Goal

- 普通 Flower update/self-update 只更新内置 Skill-Garden 时，即使已锁定的外部 GitLab/GitHub Plugin 来源不可达，也能安全冻结这些未受影响节点并完成升级。

## Scope

- `replayPlugins()` 为 Skill-Garden 更新计算并传递外部冻结 ID。
- 远程候选准备跳过冻结节点，不读取凭据、不访问网络、不依赖固定包缓存。
- Resolver 使用旧 lock 合成仅参与约束求解的冻结候选。
- Application Service 在内容投影前拆分活跃/冻结图，原样合并冻结 lock/state。
- 写入前校验冻结文件、目录和 Patch target，并拒绝活跃计划与冻结 ownership 冲突。
- 补充 Resolver、Application Service、Skill-Garden、远程 Provider 和 update replay 回归测试。
- 实现完成后更新 Plugin Runtime 项目规范。

## Non-Goals

- 不支持离线更新、重新安装或修复外部 Plugin 本身。
- 不从已安装 Skill 反向构造远程包，不降低 manifest、integrity、capability 或 Patch 校验。
- 不增加公开 `--offline` / `--skip-auth` 开关，不删除或手改用户 Plugin 声明、lock/state。
- 不升级 Trellis 到 `0.7`，不处理动态 Spec 加载。

## Key Decisions

- 冻结只由普通 Flower 更新的受控内部调用启用；显式外部 Plugin update 继续要求来源可达。
- 冻结节点使用旧 lock 的精确身份和依赖参与求解，但不进入 `readPackage()`、内容投影或 Patch catalog 读取。
- 冻结不是跳过校验：既有 state 摘要必须匹配；路径漂移、依赖范围不满足或目标冲突继续 fail-closed。
- 活跃 content/Patch 不得修改冻结节点拥有或打过 Patch 的目标，否则旧 state provenance 会失效。
- 继续复用统一 InstallPlan、Transaction Writer 和 Flower update 补偿，不建立第二套离线写入流程。

## Key Context

- 当前阻塞来自 `src/commands/plugin-remote.js` 对完整远程 lock 执行 `prepareRemoteLock()`。
- `src/plugin/application-service.js` 的现有 `preserveIds` 在完整投影后才生效，需要前移到 Resolver 与投影边界。
- 既有契约要求普通 Flower update 不升级外部 Plugin，冻结节点必须原样复用旧 lock/state。
- 公司 `rd-guide` GitLab 仅内网可达，登录或联网不能作为外部环境升级的解决方案。

## Risks / Deferred

- 拆分完整图投影时必须保持拓扑顺序、state 排序、目录 ownership 与 changed-only 稳定。
- 冻结 Patch target 与活跃 Patch 的共享目标必须明确失败，不能尝试局部重算。
- migration 是全局 state 字段，需要兼容“外部冻结、Skill-Garden 活跃”和“Skill-Garden 冻结”两种路径。
- 公开通用离线模式及外部 Plugin 离线修复能力延后，不在本任务扩展。

## Acceptance

- 无凭据、无缓存、GitLab 不可达时，普通 Skill-Garden update/replay 成功，且冻结 Plugin 的 lock/state/文件保持不变。
- 冻结路径不调用远程客户端；显式外部 Plugin update 仍按原规则失败。
- 冻结 state 漂移、依赖范围不满足或 content/Patch 目标冲突时，preflight 稳定失败且零写入。
- 既有 Skill-Garden 冻结、完整在线重放、事务补偿、capability 与 Patch 门禁回归不退化。
- focused tests、完整 `npm test`、Patch 检查、打包 dry-run、语法检查和 `git diff --check` 全部通过。

## Next Step

- Check-All 与规范更新均已完成，进入精确提交与任务进度同步。
