# 内置 skill-garden 与旧 CLI 迁移技术设计

## 1. 迁移后的入口

```text
init/update/applyEnhancements facade
              |
      Plugin application service(P2)
              |
 builtin provider -> skill-garden payload adapter
              |
 capability system grant(P4)
              |
 InstallPlan + transaction writer
              |
 .flower/plugins + lock + state
```

`applyEnhancements()` 只做参数适配和兼容日志，不再拥有成功状态。

## 2. 内置 payload adapter

Adapter 根据现有 `selectVariant()`/`resolveEnhancementSnapshot()` 选择快照，将 skill、script、Flower asset、skill-garden catalog 和 flower catalog 规范化为标准 Plugin package/InstallPlan 输入。0.5/old legacy 后处理在 system capability 下作为 Flower 内部 migration operation 表达，外部 Plugin 不可使用。

## 3. 迁移算法

1. 若已有新 lock/state，验证并直接重放。
2. 否则只读旧 manifest 和目标文件。
3. 构造内存中的直接声明、锁定 Plugin、平台投影和 ownership。
4. 对旧 paths 与 Patch provenance 核对当前 hash；无法证明的路径不纳入可删除 ownership。
5. 通过统一事务写新 plugins/lock/state。
6. state 记录 legacy manifest schema、路径和迁移摘要；旧文件保留且不再写。

## 4. Update-check

新增 `.flower/settings.json` 保存提交策略，`.flower/update-check.tmp` 保存本机缓存。读取优先新位置，缺失时读取旧位置；首次新写通过 changed-only 原子写完成迁移。旧缓存错误只降级为无缓存，不覆盖策略。

## 5. Uninstall

卸载前冻结 state 清理计划；Trellis uninstall 成功后交给 transaction writer 删除 skill-garden owned 目标。`.trellis/` 内部文件由 Trellis 自己删除，不由 Plugin writer重复处理。其它 Plugin 仍存在时重写 lock/state 去除 skill-garden 节点并保留 `.flower/`。

## 6. 回滚

- 在 facade 接管前保留现有增强链测试作为行为基线。
- 新 Runtime 失败时事务恢复目标和 `.flower/`；旧 manifest 始终保留，可用于诊断。
- 不允许长期双写旧 manifest；若迁移入口未就绪，保持旧链而不是部分写新状态。
