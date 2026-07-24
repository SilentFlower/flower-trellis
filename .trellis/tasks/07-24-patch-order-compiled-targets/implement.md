# Patch 顺序依赖与 Target 编译层实施计划

## 1. Patch Schema 与 Catalog 身份

- [x] 在 JS Patch Engine 中校验 catalog descriptor `id`、重复 catalog ID、可选 policy 文件和 Core 构造的 marker identity。
- [x] 将 Patch、Bundle、operation 唯一性从全局集合调整为 catalog-local，并为规范化对象增加 `catalog`、`qualifiedId`、qualified Patch/Bundle identity。
- [x] 为 operation schema 增加可选 `after`、`dependsOn` 字段校验，保持 Patch `schemaVersion: 2`。
- [x] 同步 Python consumer 的单 catalog identity 和引用语法，保留 `prepare_patches()` 现有调用签名。
- [x] 更新所有内置 JS catalog 调用点，固定 descriptor ID 为 `skill-garden`、`flower`。

## 2. Bundle 多归属与稳定排序

- [x] 重构 catalog load 为“完整加载 -> Bundle selection -> selected Patch union”，保留 Patch 的稳定多 Bundle membership。
- [x] 建立完整 qualified operation 索引，统一解析 catalog-local 裸引用和跨 catalog qualified reference。
- [x] 实现 JS 稳定 Kahn 拓扑排序，验证未知引用、自引用、重复关系、selection closure 和循环，确保 target 计算前失败。
- [x] 实现 Python 等价稳定排序和确定性错误语义。
- [x] 让 target preflight 按解析后的全局 operation 顺序执行，不为相同 target 自动创建依赖边。
- [x] 以 trellis-brainstorm 作为双语义 dogfood：声明 `auto-task-create dependsOn planning-authorization`，并声明 `planning-readiness after planning-handoff`；不在两组之间增加依赖。

## 3. Plan、Conflict 与 Provenance

- [x] 为 plan 增加 `selectedBundles`、`selectedPatches`、`operationOrder`、qualified `catalogOperations` 和 target `operationEntries`。
- [x] 保留 `id/patch/bundle` 本地兼容字段；`bundle` 使用第一归属，`bundles` 保存全部 qualified membership。
- [x] 将 JS/Python apply provenance 升级为 schema v2，并同步 manifest 测试。
- [x] 修改 catalog hash 输入，加入 catalog ID 与 catalog-relative path，排除绝对路径。
- [x] 让 compatibility/conflict policy 携带 owner catalog，聚合多 catalog 诊断，按 catalog-local/qualified 规则解析 `whenOperations`，并输出 qualified rule/evidence。
- [x] 验证内置 marker 字节不变；非内置 synthetic catalog 使用 qualified operation marker。

## 4. 共享 Pinned Fixture

- [x] 新增 `src/lib/patch-fixture.js`，提取全平台 init 参数、内置 catalog descriptors、snapshot 校验、coverage、full plan、compatibility 和 conflict report 构建。
- [x] 精简 `scripts/check-patch-conflicts.mjs` 为共享 helper 的调用方，保持现有命令输出和失败语义。
- [x] 为共享 helper 添加必要的公共 API JSDoc，避免脚本复制路径与参数。

## 5. Compiled Targets 归属调整

- [x] 在 Skill-Garden 新增 `scripts/generate-compiled-targets.py`，复用 Python consumer 生成 Claude + Codex canonical full plan。
- [x] 将确定性 `plan.json` 与最终文件、changed-only `.diff` sidecar 合并输出到 `vendor/skill-garden/compiled-targets/<version>/full/targets/`。
- [x] 增加最终 target 与 `.diff` sidecar 的同名和文件/目录前缀冲突检查。
- [x] 保留 staging、严格 semver 目录边界、稳定 unified diff 与 `--check` 逐字节漂移检测。
- [x] 从 Flower 主仓删除顶层 `compiled-targets/` 与只服务旧归属的 Node 生成器；全平台双 catalog fixture 继续仅作临时冲突/coverage 验证。
- [x] 更新 Flower `patch:targets`、`patch:targets:check` 与 `npm test`，通过稳定 resolver 调用 Skill-Garden 生成器和锁定 Trellis executable。
- [x] 将 AI context budget 的静态最终文件输入切换到 Skill-Garden canonical compiled files；Phase summary 与 SessionStart 继续真实执行。
- [x] 首次生成当前 Trellis 版本的 Skill-Garden compiled targets，并证明 Flower 工作树不保留全平台 matrix。
- [ ] Phase 3.4 用户确认后提交 compiled targets 与实现变更。

## 6. 测试与规范

- [x] 扩展 JS Patch Engine 单元测试，覆盖排序、错误、稳定性、多归属、qualified identity、跨 catalog 引用和 marker 兼容。
- [x] 增加两个 synthetic catalog 使用相同本地 ID 的隔离测试。
- [x] 扩展 Python 测试并与 JS 共享 fixture 对完整结构化计划、错误和 provenance 做一致性比较。
- [x] 调整 compiled target 测试，覆盖同树 sidecar 布局、路径冲突、canonical profile、重复生成零变化、check 漂移失败、版本目录替换和稳定 diff header。
- [x] 调整 npm pack 与 sync 断言，证明 vendor compiled targets 不进入 Flower 发布包或 `enhancements/0.6`。
- [x] 更新 Patch Engine、目录结构、AI context budget/测试入口等相关 Trellis spec 到新的仓库归属与平台边界。
- [x] 更新 Skill-Garden 源后运行 `npm run sync`，确保 `enhancements/0.6` 发布快照一致。

## 7. 验证命令

```bash
node --test test/js/patch-engine.test.js test/js/patch-conflicts.test.js test/js/apply-enhancements.test.js
python3 -m unittest test.python.test_skill_garden_patches
npm run sync
npm run patch:targets
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs
npm test
npm pack --dry-run --json
git status --short
```

## 8. 高风险文件与检查点

- `src/lib/patch-engine.js`：排序、identity、marker、plan/provenance 的核心变更；每完成一层先跑 JS Patch Engine 单测。
- `vendor/skill-garden/scripts/apply-trellis-patches.py`：独立安装兼容边界；与 JS fixture 对齐后再同步 snapshot。
- `src/lib/patch-conflicts.js`：policy 引用从本地 ID 迁移到 qualified identity，需确认现有 conflicts 无需批量改写。
- `src/lib/patch-fixture.js`：只负责 Flower 全平台双 catalog 临时验证，不再承担可提交产物生成。
- `vendor/skill-garden/scripts/generate-compiled-targets.py`：独立发布边界的 canonical fixture、plan 序列化与安全目录替换。
- `vendor/skill-garden/compiled-targets/`：仅由生成器写入；人工修改必须被 check 捕获。

## 9. 回滚点

- 排序/identity 失败：回滚 planner graph 与新字段，不改 selector/adapter apply 实现。
- provenance consumer 回归：保留 schema v2 的 qualified 计划，临时恢复兼容投影输出后定位调用方。
- compiled target 生成失败：不替换 Skill-Garden 现有目录；删除 staging 后重跑。
- Trellis 版本升级导致大面积 selector 漂移：先更新 compatibility/baseline 并通过 full conflict check，再刷新 compiled targets。

## 10. 启动前复核

- [x] `prd.md`、`design.md`、`implement.md` 事实与范围一致，无已解决的 Open Questions。
- [x] `implement.jsonl` 与 `check.jsonl` 已配置真实 spec/research 上下文。
- [x] brief 已由最终三件套生成并经用户确认。
- [x] 任务已由用户确认并通过 `task.py start` 进入 `in_progress`。
