# Skill-Garden 与上游 Trellis 冲突处理实施计划

## 1. 实施顺序

### 1.1 固化上游证据与测试矩阵

- [x] 从 pinned `@mindfoldhq/trellis@0.6.5` 模板构建隔离 fixture helper，覆盖 Workflow、Start、Brainstorm、Update-Spec、Finish-Work 与 shared Hook。
- [x] 将 `research/current-conflict-inventory.md` 中 C-WF-001~005 转为可执行正向/反向断言。
- [x] 增加当前 24 个 Patch/全部 target kind 的三方覆盖表测试，确保新增 catalog 不遗漏 Skill/Hook/配置。

### 1.2 共享兼容与冲突 Policy

- [x] 在 Skill-Garden 0.6 `overrides/` 新增 `compatibility.json` 和 `conflicts.json`。
- [x] 定义并校验 schemaVersion、compatibleLine、testedVersions、三种 severity、whenOperations 和三个 assertion type。
- [x] `npm run sync` 将 policy 原样复制到 `enhancements/0.6`，MANIFEST 记录 policy 文件。

### 1.3 JS Conflict Evaluator

- [x] 新增 `src/lib/patch-conflicts.js`，实现 policy load、semver 解析、版本分级、最终 plan 断言和聚合错误。
- [x] evaluator 只读取 `plan.files[].next` 和 selected operation，不自行修改文件或重复 Patch selector 逻辑。
- [x] `applyEnhancements()` 在 apply/资产/manifest 前运行 evaluator；error 零写入，warning/info 结构化输出。
- [x] Patch 汇总拆分 `missing-target` 与 `optional-skip`，避免正常平台缺失显示成失败。

### 1.4 Python Consumer Parity

- [x] `apply-trellis-patches.py` 读取相同 policy，并从目标 `.trellis/.version` 执行版本与最终产物检查。
- [x] Python error 在 `apply_prepared()` 前退出，warning/info 不阻断。
- [x] Python 汇总同样区分 missing target 和 optional failure；`install.sh` 不复制规则。

### 1.5 Workflow Section Ownership Patch

- [x] 新增 `workflow/phase-ownership` Patch，替换 Active Task Routing、Phase 2.1、Phase 2.2、Phase 3.3、Phase 3.4 五个 section。
- [x] Active Task Routing/Phase 2.1/2.2 统一通过 `trellis-route`，删除 direct dispatch 与 auto-fix walkthrough。
- [x] Phase 3.3 只指向 Update-Spec 自主三态；Phase 3.4 只指向 Trellis Push。
- [x] Hub 删除“覆盖下层/下层 inactive”文字并保留短门禁；审计 planning/in-progress State 的一跳必要性。
- [x] 仅在 intent-routing/全量安装中选择 Workflow ownership Patch；Update-Spec 精细别名保持单 Skill 范围，避免意外接管 Phase 2/3。

### 1.6 维护者与发布门禁

- [x] 新增 `scripts/check-patch-conflicts.mjs`，使用真实 pinned Trellis 模板、真实 catalog 和 evaluator 输出报告。
- [x] 接入 `npm test`；warning 返回 0，error/结构错误返回非 0。
- [x] `check-snapshot.mjs` 复用同一模块，并验证 vendor/snapshot overrides 一致。

### 1.7 Dogfood、预算与文档

- [x] 运行 `npm run sync` 和 dogfood apply，确认新旧 marker 原位迁移且二次运行修改 0。
- [x] 更新 Patch Engine、Enhancements Model、Config/State、目录结构、上下文预算和 release spec。
- [x] 更新 README 的兼容版本、诊断分级和未安装入口展示。
- [x] 重新登记最终上下文 baseline，但不提高 target/review ceiling。

## 2. 验证命令

```bash
node --test test/js/patch-conflicts.test.js
node --test test/js/patch-engine.test.js test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
node scripts/check-patch-conflicts.mjs
npm test
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
npm run sync
diff -qr vendor/skill-garden/.trellis/0.6 enhancements/0.6
git diff --check
git -C vendor/skill-garden diff --check
```

提交 Skill-Garden 源与父仓快照后、push 前运行：

```bash
node scripts/check-snapshot.mjs
```

## 3. 必测场景

- [x] Trellis `0.6.5`：tested，全部冲突断言通过。
- [x] Trellis `0.6.6`：untested warning，Patch 和断言通过后允许写入。
- [x] Trellis `0.7.0` / `1.0.0`：unsupported error，Patch/资产/stale/manifest 零写入。
- [x] Trellis `0.7.0` 上游结构已漂移：仍在旧 baseline preflight 前返回 unsupported 与 `--no-enhance` 指引。
- [x] 版本缺失/损坏但强制 0.6：invalid error。
- [x] 恢复上游 direct dispatch、auto-fix 或 Never push 任一签名：error，零写入。
- [x] Hub/State 同义短提示超出 max-occurrences：warning，不阻断。
- [x] 缺失 Cursor/其他平台入口：info/missing-target，不计 warning/error。
- [x] `--skills intent-routing`、Update-Spec/Finish-Work aliases 只运行已选 operation 对应规则。
- [x] JS/Python 相同 fixture 返回相同 version status 和 diagnostic 集合。
- [x] JS/Python policy target 都拒绝 Windows drive path，整数/布尔 schema 边界一致。
- [x] 当前 dogfood、fresh 0.6.5、旧 marker 升级三种安装均幂等。
- [x] 0.5/old 安装回归不加载新 policy。

## 4. 风险与回滚点

| 风险 | 控制与回滚 |
|---|---|
| section replace 误删上游平台差异 | baseline 全文 + 保留行为正向断言；失败时恢复首次备份 |
| conflict rule 与 Patch selector 重复成第二套变换逻辑 | evaluator 只断言 plan.next，不生成 content、不定位替换范围 |
| 新版本门禁阻断正常 patch 升级 | 同一 0.6.x warning 放行；只阻断新 minor/major |
| 精细安装误跑未选规则 | `whenOperations` 过滤并增加 aliases 集成测试 |
| JS/Python 诊断漂移 | 共享 policy + parity fixture，比较 ID/severity/target/version status |
| 发布脚本依赖当前 dogfood 状态 | checker 使用隔离 pinned upstream fixture，不读取活动任务/runtime |
| 上下文去重遗漏当前状态一跳 | State 正向动作断言 + SessionStart/Phase summary 实测 |

## 5. 完成门禁

- [x] PRD AC1-AC7 全部有自动化或明确人工证据。
- [x] C-WF-001/002/003 最终产物中不存在覆盖式压制或互斥旧 walkthrough。
- [x] C-WF-004/005 有逐项保留/删除理由与预算证据。
- [x] runtime、npm test、check-snapshot 和维护者脚本使用同一 JS evaluator；Python 使用同一 policy 并通过 parity。
- [x] 完整 Check-All 通过后才能进入 Update-Spec 与 Trellis Push。
