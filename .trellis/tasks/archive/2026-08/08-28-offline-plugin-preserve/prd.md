# 修复外部 Plugin 不可达时阻塞 Flower 升级

## Goal

当 Flower 普通升级只更新内置 `flower/skill-garden` 时，允许 Runtime 在无法访问外部
GitLab/GitHub 来源的环境中冻结未受影响的外部 Plugin，并继续完成升级。冻结节点必须保留
既有 lock、state 和受管内容；只有冻结状态漂移、依赖约束不再满足或更新计划与冻结节点
发生路径冲突时，才要求进入可访问外部来源的环境执行完整重放。

## Background

- `flower-trellis update` 在 Trellis 更新后调用 `replayPlugins()`，当前实际执行
  `plugin update flower/skill-garden`；任一 Plugin Runtime 失败会触发整条升级补偿恢复
  （`src/commands/update.js:90-120,247-286`）。
- 单 Plugin update 当前先执行 `prepareRemoteLock()` 恢复完整远程锁定图，因此未更新的
  `rd-guide` 也必须具备凭据、网络或完整缓存
  （`src/commands/plugin-remote.js:634-649`）。
- `PluginApplicationService` 已有 `preserveIds`，但它在完整依赖解析与内容投影之后才替换
  lock/state 并过滤 mutation，无法避免远程包准备与 `readPackage()`
  （`src/plugin/application-service.js:553-612`）。
- 既有产品契约明确：普通 Flower update 不升级外部 Plugin；冻结节点必须复用旧
  lock/state，不能重新生成 mutation
  （`.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md`）。
- 当前真实场景中 `rd-guide` 只在公司内网可达，外部环境不能依赖登录或联网作为升级前置条件。

## Requirements

### R1. 普通升级自动冻结未受影响的外部 Plugin

- 当 `replayPlugins()` 更新 `flower/skill-garden` 时，从现有 lock 中选择除本轮更新目标外的
  外部 Plugin 作为冻结节点。
- 冻结行为是普通 Flower update/self-update 的内部语义，不新增要求用户理解的公开
  `--offline` 或 `--skip-auth` 开关。
- 本轮显式更新目标及其非冻结依赖仍按现有 Provider、Resolver 和 capability 规则处理。

### R2. 冻结节点零远程读取

- 冻结节点不得调用 GitLab/GitHub `prepareLocked()`、不得读取凭据、不得发起网络请求，
  也不得要求本地存在固定包缓存。
- Resolver 应使用旧 lock 构造只参与约束求解的锁定候选，保留精确
  `version/source/commit/integrity/dependencies/compatibility/capabilities`。
- 冻结候选不得进入 `readPackage()`、内容投影或 Patch catalog 读取。

### R3. 保留 lock、state 与受管内容

- 冻结节点的 lock entry 和 state entry 必须逐字段复用旧值。
- 冻结节点不得生成普通内容 mutation、Patch mutation、目录 claim 或删除计划。
- 冻结节点受管文件、目录和 Patch target 必须保持现有字节；无冲突升级后其 state 摘要不得变化。
- 全局 migration 状态继续由活跃 Skill-Garden 投影维护；当 Skill-Garden 本身被冻结时，才沿用旧 migration。

### R4. 冻结前校验与冲突门禁

- Runtime 必须在写入前校验冻结 state 中的文件和目录仍匹配记录摘要；缺失或漂移时按现有
  `PLUGIN_TARGET_DRIFT` / `PLUGIN_CONTENT_CONFLICT` 语义失败并保持零写入。
- 活跃 Plugin 的普通内容或 Patch 计划若命中冻结节点拥有的文件、目录前缀或 Patch target，
  必须在事务前失败，不能覆盖冻结内容或留下失效 state。
- 活跃候选的新依赖范围若不满足冻结 lock 的精确版本，应按现有依赖冲突语义失败；不得联网
  猜测或静默升级冻结依赖。

### R5. 其它生命周期语义不变

- 显式更新外部 Plugin 仍必须准备其远程候选，不能通过冻结机制更新外部版本。
- 普通 `plugin replay`、`plugin verify`、全量外部 update、capability approval、Patch 冲突、
  Transaction Writer 原子写入和 Flower update 补偿恢复保持现有行为。
- 来源可达且完整重放成功时，结果应与现有在线路径兼容。

## Acceptance Criteria

- [ ] 项目锁定 `flower/skill-garden` 和无缓存、无凭据、不可访问的 GitLab Plugin 时，
      `replayPlugins()`/普通 Flower update 能更新 Skill-Garden 并成功退出。
- [ ] 上述离线路径不会调用冻结 GitLab Provider 的远程客户端，外部 Plugin 的 lock/state 和
      受管文件保持不变。
- [ ] 冻结节点固定包缓存不存在时仍能成功；不能把缓存命中作为离线升级必要条件。
- [ ] 冻结文件或目录发生漂移时，升级在写入前失败，Skill-Garden、外部 Plugin 和项目
      `.flower` 状态均不产生部分更新。
- [ ] 活跃 Skill-Garden 计划与冻结 Plugin 的 content/Patch target 冲突时，升级以稳定冲突
      诊断失败，不修改目标文件或 lock/state。
- [ ] Skill-Garden 新依赖范围不满足冻结 Plugin 版本时，Resolver 返回依赖冲突且零写入。
- [ ] 显式 `plugin update rd-guide/<plugin>` 在无凭据/无网络时仍失败，不会错误套用冻结路径。
- [ ] 既有 `replay({ preserveIds: [flower/skill-garden] })` 回归继续通过，冻结 Skill-Garden 时
      lock/state/migration 保持原样。
- [ ] focused Plugin/upgrade 测试、完整 `npm test`、Patch 目标检查、打包 dry-run、语法检查和
      `git diff --check` 全部通过。

## Non-Goals

- 不支持在离线环境更新、重新安装或修复外部 Plugin 本身。
- 不把已投影 Skill 目录反向打包成外部 Plugin 来源，也不降低 manifest/integrity 校验。
- 不删除外部 Plugin 声明，不手工修改用户 lock/state，不绕过 capability 或 Patch 门禁。
- 不在本任务中升级 Trellis 到 `0.7` 或引入动态 Spec 加载。
