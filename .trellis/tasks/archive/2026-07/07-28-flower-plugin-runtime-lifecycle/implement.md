# Flower Plugin Runtime、依赖解析与生命周期 CLI 实施计划

## 1. 前置门禁

- [ ] P1 已完成并冻结 schema、DTO、错误码、stable JSON、tree hash 与 Project Store API。
- [ ] P2 只导入 P1 契约，不复制或修改近似类型。

## 2. 实施步骤

### A. Source Registry 与 Provider

- [ ] 实现 registry 注册、按 source ID 查找和 provider capability 校验。
- [ ] 实现 builtin/local provider，共用 P1 package validator 与 tree hash。
- [ ] 补 provider 顺序、重复 source、摘要错误和路径逃逸测试。

### B. Resolver 与 Lock Builder

- [ ] 实现候选稳定排序、锁定优先和 SemVer 约束收集。
- [ ] 实现回溯求解、共享依赖、自依赖、循环和冲突诊断。
- [ ] 实现稳定拓扑、orphan 计算和 lock builder。
- [ ] 覆盖 add、frozen replay、显式 update、remove 后重算。

### C. 平台检测与内容投影

- [ ] 泛化平台 descriptor registry并保持现有增强链兼容。
- [ ] 实现 `--platform`、已存在 root 检测和无平台阻断。
- [ ] 实现共享物理 root 去重、canonical 内容和 override 合并。
- [ ] 生成 P1 `ContentMutation`，不直接写目标。

### D. Install Planner 与 Transaction Writer

- [ ] 合并全部普通内容 mutation并执行路径/所有权/前缀冲突检查。
- [ ] 实现 before-hash 复核、staging、backup、替换和逆序恢复。
- [ ] 将 plugins、lock、state 纳入事务顺序，确保 state 最后写。
- [ ] 实现 changed-only、受控删除和恢复失败证据保留。

### E. Application Service 与 CLI

- [ ] 实现 list/add/update/remove/verify 用例。
- [ ] 实现独立 Plugin parser、dry-run、JSON 输出和退出码。
- [ ] 在 `src/cli.js` 透传前接管 `plugin`，保留现有命令行为。
- [ ] 无 `.flower/` 时按需初始化最小 Runtime，不创建 `.trellis/`。

### F. 验证

- [ ] 运行 resolver、projector、planner、transaction 和 CLI 定向测试。
- [ ] 运行现有 `cli-args`、平台分发、apply-enhancements 回归。
- [ ] 运行完整 `npm test` 和 `npm pack --dry-run --json`。
- [ ] 输出 P2 Runtime/Resolver/InstallPlan 契约交接 research，供 P4/P5/P6 使用。

## 3. 文件所有权

- `src/plugin/application-service.js`
- `src/plugin/resolver/**`
- `src/plugin/sources/source-registry.js`
- `src/plugin/sources/builtin-provider.js`
- `src/plugin/sources/local-provider.js`
- `src/plugin/install/platform-detector.js`
- `src/plugin/install/content-projector.js`
- `src/plugin/install/install-planner.js`
- `src/plugin/install/transaction-writer.js`
- `src/commands/plugin.js` 中非远端、非作者工具部分
- `src/cli.js`、`src/lib/cli-args.js` 的最小接管适配
- 对应 `test/js/plugin-*.test.js`

## 4. 验证命令

```bash
node --test test/js/plugin-source-registry.test.js
node --test test/js/plugin-dependency-resolver.test.js
node --test test/js/plugin-content-projector.test.js
node --test test/js/plugin-install-planner.test.js
node --test test/js/plugin-transaction-writer.test.js
node --test test/js/plugin-lifecycle-cli.test.js
node --test test/js/platform-skill-distribution.test.js test/js/update-backups.test.js
npm test
npm pack --dry-run --json
git diff --check
```

## 5. 高风险检查点

- [ ] 依赖冲突、循环、路径冲突和 before-hash 漂移必须零写入。
- [ ] 普通 Plugin 不得隐式安装 `skill-garden` 或创建 `.trellis/`。
- [ ] 无平台时不得沿用 Claude fallback。
- [ ] 共享依赖和共享物理 root 不得重复安装。
- [ ] transaction writer 不得调用 `copyPath()`。
- [ ] 删除必须同时满足 state ownership 与当前 hash。
- [ ] P2 不得访问 GitLab、执行 Patch 或迁移旧增强状态。

## 6. 回滚点

- `plugin` 未接管 init/update 前可整体移除新 CLI 分支和 Runtime 模块。
- transaction 恢复失败必须保留证据，不自动写成功 state。
- 平台 registry 泛化若影响现有增强链，保留旧导出兼容层并回滚消费者变更。
