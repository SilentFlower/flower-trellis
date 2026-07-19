# 统一 Patch 注入引擎与 Overrides 目录重构 - 实施计划

## 1. 实施顺序

### 1.1 建立契约与测试骨架

- [x] 新增共享 Patch fixture corpus，覆盖三种 operation、各 target adapter、Bundle 选择、legacy migration、required/optional 和路径安全。
- [x] 将 JS `enhancement-transform` 测试改为 Patch schema v2，并保留旧 transform marker/目标状态 migration fixture。
- [x] 将 Python parity 测试入口改为 `apply-trellis-patches.py`，相同 fixture 在 JS/Python 下断言等价结果。
- [x] 为 `applyEnhancements()` 增加“全部 Patch 预检失败时资产/manifest 零写入”的集成测试。

### 1.2 实现统一 JS Patch Engine

- [x] 新增 catalog/Bundle loader，递归加载叶子 `patch.json`，校验全局 ID、引用、aliases、installMode 和安全路径。
- [x] 实现 `preparePatchPlan()` / `applyPatchPlan()`，复用首次备份和 changed-only 写入。
- [x] 实现 literal、Markdown workflow-state/section/prologue/body、whole-file Adapter。
- [x] 实现 JSON Hook、YAML key、TOML section Adapter；动态命令只走白名单 resolver。
- [x] 实现旧 transform/Hub/state/Skill marker 与 Hook fingerprint 迁移。
- [x] 输出 Patch/Bundle/target/hash/status/warning 结构化结果。

### 1.3 重构 Skill-Garden 0.6 目录

- [x] 创建 `overrides/patches/{workflow,skills,hooks}` 和 `overrides/bundles`。
- [x] 将 `intent-routing.json` 的各 operation 拆到目标叶子目录，selector/content 就近放置。
- [x] 迁移 `workflow-request-triage` 时核对任务创建前 dirty baseline 的孤立 `?`，只迁移可追溯的有效规则，并在删除旧文件前保留 diff 证据。
- [x] 将 Workflow Hub 迁为结构化 Phase Index Patch。
- [x] 将五个 workflow-state 迁为 body replace Patch；planning 与 in-progress 各用一个叶子目录，通过 `content.sources` 组合 `common-content + subagent/inline-content` 差异。
- [x] 将 Update-Spec 迁为 section insert/replace/remove，删除 Interactive 冲突和顶部覆盖式长块。
- [x] 将 Finish-Work 迁为保留 frontmatter 的 document-body replace。
- [x] 将 shared `inject-workflow-state.py` 迁为 whole-file Patch。
- [x] 删除 0.6 `transforms/`、`workflow.md`、`workflow-states/`、`skills/`、`hooks/` 旧并列源结构。

### 1.4 迁移 Flower 平台修改

- [x] 在 `src/patches/platforms` 建立 Flower catalog 与 full-only Bundle。
- [x] 把 Codex `SessionStart` 两个命令的去重、matcher 归位和 timeout 迁移为 JSON Hook Patch。
- [x] 把 Claude startup update Hook 的归位和 timeout 迁移为 JSON Hook Patch。
- [x] 把 `.trellis/config.yaml` 的 `codex.dispatch_mode=sub-agent` 迁为 YAML key Patch。
- [x] 把旧 `[features.multi_agent_v2]` 清理迁为 TOML section remove Patch。
- [x] 删除正常路径对 `codex-tweaks.js` / `claude-tweaks.js` 的调用；只保留 Patch resolver 所需的纯函数或迁入 Adapter。

### 1.5 改造安装流水线

- [x] `applyEnhancements()` 在 0.6 同时加载 Skill-Garden snapshot catalog 与 Flower catalog，先 prepare/apply Patch，再执行资产复制、common、stale cleanup 和 manifest。
- [x] 0.6 删除 `injectSkillOverrides()` / `injectHookOverrides()` 调用；`workflow-inject.js` 仅保留 0.5/old legacy 分支或改名明确所有权。
- [x] `.flower-manifest.json` 写入 Patch catalogHash 与 applied provenance，并保留 updateCheck 策略兼容。
- [x] `--skills` 通过 Bundle ID/aliases 精确选择 Patch，不写 manifest、不清 stale。
- [x] 缺失平台目录安全跳过；已有平台目录中声明 `missing=create` 的配置文件按现有产品行为创建。

### 1.6 改造独立安装器

- [x] 新增 `vendor/skill-garden/scripts/apply-trellis-patches.py`，与 JS 共享 schema/fixture 语义。
- [x] `install.sh` 的 0.6 路径只调用一次 Patch runner，删除 Workflow/Skill 内嵌 Python。
- [x] shared Hook Patch 进入独立安装；Flower catalog 不进入独立安装。
- [x] 0.5/old legacy 逻辑保持原样。
- [x] 验证 full install、`--skills intent-routing`、Update-Spec/Finish-Work aliases 和二次安装幂等。

### 1.7 上下文预算与快照

- [x] 更新 `check-ai-context-budget.mjs`，从 dogfood 最终 workflow 解析五个 state body。
- [x] 增加最终 Update-Spec/Finish-Work Skill 指标与迁移前 baseline。
- [x] 保持默认 warning-first、strict high-warning failure；不提高既有 Workflow 阈值。
- [x] 更新 `sync-enhancements.mjs` 的 MANIFEST 字段为 patchFiles/bundles，移除 transforms/workflowStates/skillOverrides/hookOverrides 旧统计。
- [x] 运行 `npm run sync`，确认 vendor 源与 `enhancements/0.6` 快照一致。
- [x] 对当前项目运行 dogfood update，确认旧 marker/sentinel 被迁移且无重复内容。

### 1.8 规范与文档

- [x] 将 `trellis-injection-transforms.md` 重写为统一 Patch Engine 长期契约并更新 CLI index。
- [x] 更新 `enhancements-model.md` 的目录、流水线、幂等、双消费者和 Skill/Workflow 场景。
- [x] 更新 `config-and-state.md` 的 Patch provenance 与 manifest 写入顺序。
- [x] 更新 `ai-context-budget.md` 的最终产物测量方式和新 Skill baseline。
- [x] 搜索并清理 0.6 主路径中对 `overrides/transforms`、additive state、独立 Skill/Hook injector 的陈旧说明。

## 2. 验证命令

```bash
node --test test/js/patch-engine.test.js
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
npm test
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
npm run sync
git diff --check
```

`node scripts/check-snapshot.mjs` 属于 Phase 3.4：Skill-Garden 源提交、父仓 submodule pin 与
`enhancements/` 快照提交完成后运行，通过后才能 push。

额外验证：

- [x] 从未注入的 Trellis 0.6.5 fixture 全装。
- [x] 从当前 beta 已注入项目升级，覆盖旧 transform/Hub/state/Skill marker。
- [x] required selector 漂移，确认 Patch、资产、stale path、manifest 均零变化。
- [x] Codex-only、Claude-only、双平台和无平台目录 fixture。
- [x] 损坏 JSON/TOML/YAML 时失败保护，不覆盖用户配置。
- [x] preflight 后并发修改目标，apply 停止且资产未写入。
- [x] `--skills` 精细安装只命中目标 Bundle。
- [x] 重复全装与重复独立安装的目标文件树 hash 不变。
- [x] 0.5/old 回归测试通过。
- [x] npm pack 内容包含新 Patch catalog，不包含 vendor submodule 或旧 transforms 残留。

## 3. 风险点与回滚点

| 风险 | 控制与回滚 |
|---|---|
| Workflow-state body 替换遗漏上游有效一跳动作 | 对照 Trellis 0.6.5 原 body 建 fixture，正反向断言最终动作；从首次备份恢复 |
| Update-Spec/Finish-Work 去重误删有效内容 | 章节级 selector 与 final-skill snapshot 测试；required 漂移零写入 |
| JSON Hook 归位覆盖用户 Hook | 结构化 identity 只匹配 Flower/Trellis command needle；保留其它 group/item |
| YAML/TOML 自定义格式 | Adapter 只修改目标 key/section，无法唯一解析时失败，不格式化整个文件 |
| JS/Python consumer 漂移 | 共享 fixture corpus，CI 同时跑两端结果对比 |
| 旧 transform 源在任务前已有孤立 `?` dirty | 以已提交正文 + baseline diff 反向核对，只迁移有效规则；不提前回退用户改动 |
| 旧版降级不识别新 marker | 明确失败保护；恢复 `.trellis/.backup-flower/` 后再应用旧版 |
| 大改导致上下文继续增长 | 最终产物预算 + strict 审计；优先替换/删除，不提高现有 ceiling |

## 4. 实施完成门禁

- [x] PRD AC1-AC8、AC10-AC11 全部有测试或人工证据。
- [x] AC9 的 vendor/snapshot/dogfood 提交前内容一致性已有证据。
- [ ] AC9 的 clean-state `check-snapshot` 在 Phase 3.4 提交后、push 前执行。
- [x] 0.6 运行日志只出现 Patch 汇总，不再出现 transform/workflow override/skill override/hook override 多套汇总。
- [x] 当前 dogfood Workflow 与两个 Skill 无双流程、无“忽略下方旧规则”式补丁文本。
- [x] vendor、snapshot、dogfood 三份源语义一致。
- [x] 默认与 strict 上下文预算结果均已评审；若 strict 仍失败，不进入提交阶段。
- [ ] 最终 full-scope Check-All 通过后再进入 Update-Spec 与 Trellis Push。

## 5. Check-All 修复记录

- [x] `CHK-001`：JS/Python 新建父目录在 preflight/apply 双重校验真实路径，首次备份拒绝软链逃逸。
- [x] `CHK-002`：`missing=create` 仅允许 `json/yaml/toml` target，普通文件声明在 schema 阶段失败。
- [x] `CHK-003`：TOML section parser 支持引号、数组表和行尾注释，损坏 header 仍失败保护。
- [x] `CHK-004`：implement/check JSONL、design schema 与稳定 provenance 已同步最终 Patch 契约。
- [x] `CHK-005`：AC9 拆分为提交前内容一致性与 Phase 3.4 提交后、push 前 clean-state 检查。
- [x] Update-Spec Patch 已统一为英文 AI-facing 协议，仅保留需要识别的中文用户字面输入。
