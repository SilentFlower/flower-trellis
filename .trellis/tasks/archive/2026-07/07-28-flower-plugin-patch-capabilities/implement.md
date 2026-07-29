# Flower Plugin Capability Policy 与 Patch Engine 集成实施计划

## 1. 前置门禁

- [ ] P1 Capability/Mutation/Lock DTO 已冻结。
- [ ] P2 InstallPlan 与 transaction writer 接口已冻结后再完成写盘集成。

## 2. 实施步骤

### A. Profiles 与 Policy Engine

- [ ] 定义 profile/capability 常量、层级和 Runtime policy version。
- [ ] 实现四层交集、required/optional 和稳定诊断。
- [ ] 实现 builtin 私有信任标记，覆盖外部 system 伪造测试。

### B. Integration 子协议

- [ ] 校验 insert、允许 selector、target kind/path 和 missing policy。
- [ ] 拒绝 replace/remove/create/hook/adapter/配置目标和未知字段。
- [ ] 为外部 catalog 生成 qualified ID 与 marker namespace。

### C. Approval

- [ ] 实现 canonical approval digest 与 lock 持久化结构。
- [ ] 实现首次确认、frozen 复用、变化失效和非交互失败。
- [ ] 实现 dry-run/JSON capability 摘要，不写盘。

### D. Patch 集成

- [ ] 合并全部 catalog，一次调用 `preparePatchPlan()`。
- [ ] 复用 compatibility/conflict report和现有诊断 formatter。
- [ ] 将 plan 转换为 `PatchMutation[]`，保留 before/after hash 与 provenance。
- [ ] 与普通 mutation 合并检查并交给 P2 transaction writer。

### E. 回归

- [ ] 覆盖 profile、越权、identity、approval、跨 catalog 和跨 mutation 冲突。
- [ ] 运行现有 Patch Engine、conflict、compiled target 和 Python parity 测试。
- [ ] 运行完整 `npm test`。

## 3. 文件所有权

- `src/plugin/capabilities/**`
- `src/plugin/install/patch-planner.js`
- `src/lib/patch-engine.js` 的最小兼容扩展（如确有必要）
- `src/lib/patch-conflicts.js` 的 Plugin catalog evidence 扩展
- 对应 `test/js/plugin-capability-*.test.js`、`plugin-patch-planner.test.js`

## 4. 验证命令

```bash
node --test test/js/plugin-capability-policy.test.js
node --test test/js/plugin-capability-approval.test.js
node --test test/js/plugin-patch-planner.test.js
node --test test/js/patch-engine.test.js test/js/patch-conflicts.test.js
python3 -m unittest discover -s test/python -p 'test_*.py'
node scripts/check-patch-conflicts.mjs
npm run patch:targets:check
npm test
git diff --check
```

## 5. 高风险检查点

- [ ] system 信任不能被序列化数据伪造。
- [ ] integration allowlist 不得因 Marketplace 或项目配置扩大。
- [ ] 外部 catalog 不得访问 Flower adapter registry或 legacy marker identity。
- [ ] 所有 catalog 必须一次 preflight，不能逐 Plugin 写入。
- [ ] approval 摘要任一绑定字段变化必须失效。
- [ ] Plugin Runtime 不直接调用 `applyPatchPlan()` 写盘。
- [ ] 不得通过放宽 required、selector、conflict 或 digest 让测试通过。

## 6. 回滚点

- 外部 Patch 可整体禁用并保留 standard 内容分发。
- Patch Engine 扩展造成回归时回滚扩展，在 plugin patch-planner 内消费现有 plan 结构。
