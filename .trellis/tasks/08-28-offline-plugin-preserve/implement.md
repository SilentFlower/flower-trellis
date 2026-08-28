# 实施计划：离线冻结未受影响的外部 Plugin

## 1. Resolver 冻结候选

- [x] 在 `dependency-resolver.js` 增加由旧 lock 构造冻结候选的内部 helper。
- [x] 为 `resolvePluginGraph()` 增加 `preserveIds` 输入，校验冻结 ID 必须存在于旧 lock。
- [x] 保持精确 dependencies/compatibility，并验证声明和活跃依赖范围仍满足冻结版本。
- [x] 增加无 Provider 候选也能解析冻结节点、范围不满足仍失败的单元测试。

## 2. Application Service 前移冻结边界

- [x] 将 `preserveIds` 从 replay 专用输入扩展到 targeted update 内部选项。
- [x] 在内容投影前拆分 active/preserved graph，确保冻结节点不调用 `readPackage()`。
- [x] 校验冻结 lock/state 完整性及当前文件、目录摘要。
- [x] 合并冻结 graph/state，正确维护 desired paths、目录 ownership 和 migration。
- [x] 在事务前拒绝 active mutation 与冻结 content/Patch target 或目录前缀冲突。
- [x] 保持既有 `replay({ preserveIds: [flower/skill-garden] })` 语义与测试。

## 3. CLI 与远程候选准备

- [x] `replayPlugins()` 更新 Skill-Garden 时计算外部冻结 ID。
- [x] `plugin update` 内部透传 `preserveIds`，不增加公开 CLI 参数。
- [x] `prepareRemoteLock()` 跳过冻结 ID；显式更新外部 Plugin 时不传冻结集合。
- [x] 验证无凭据、无缓存的远程 Provider 在冻结路径中保持零调用。

## 4. 回归测试

- [x] 离线更新 Skill-Garden 成功并保持外部 lock/state/内容不变。
- [x] 冻结缓存缺失仍成功。
- [x] 冻结文件/目录漂移时 preflight 失败且零写入。
- [x] active content/Patch 与冻结目标冲突时失败。
- [x] active 依赖范围不满足冻结版本时失败。
- [x] 显式外部 Plugin update 仍要求远程来源。
- [x] update replay 失败补偿、dry-run 和 changed-only 既有用例继续通过。

## 5. 规范与验证

- [x] 更新 `.trellis/spec/flower-trellis/cli/flower-plugin-runtime.md` 的冻结契约、错误矩阵和测试要求。
- [x] 运行受影响文件 `node --check`。
- [x] 运行 focused tests：Resolver、Application Service、GitLab Provider、Skill-Garden、update backups。
- [x] 运行 `npm test`。
- [x] 运行 `node scripts/check-patch-conflicts.mjs`。
- [x] 运行 `npm run patch:targets:check`。
- [x] 运行 `npm pack --dry-run --json`。
- [x] 运行 `git diff --check`。

## 风险点

- `projectPluginContent()` 当前默认读取完整图，拆分后必须保持拓扑顺序和 state 排序稳定。
- 冻结 Patch target 不能被活跃 Patch 重新计算，否则旧 provenance/resultHash 失效。
- migration 是全局 state 字段，不能因为冻结外部 Plugin 而错误保留旧 Skill-Garden migration。
- 远程准备跳过范围必须只来自受控内部 `preserveIds`，不能放宽显式外部 update。
