# 实施计划：Trellis Task 意图路由与声明式强化变换

## 1. 实施顺序

### Step 1. 建立零依赖测试入口

- [x] 在 `package.json` 增加统一 `npm test`，串行执行 Node `node:test`、Python `unittest` 与 context-budget 默认检查。
- [x] 新增 `test/js/` 与 `test/python/`，先写临时目录、临时 Git 仓库和 fixture helper。
- [x] 更新 `.trellis/spec/flower-trellis/cli/quality-guidelines.md` 与 `directory-structure.md`，删除“仓库无自动化测试”的过期描述。

验证：

```bash
npm test
```

初始测试允许因功能未实现而失败，但不能引入第三方测试依赖。

### Step 2. 实现声明式 transform engine

- [x] 新增 `src/lib/enhancement-transform.js`，实现声明读取、schema/path/source 校验、skill alias 过滤和 UTF-8 文本归一化。
- [x] 实现 `prepareEnhancementTransforms()`：遍历所有声明与显式目标，计算 changed/unchanged/missing/optional-skip，required 错误汇总后零写入失败。
- [x] 实现 managed marker：首次 selector 替换、已存在 marker 更新、remove tombstone、HTML/hash/slash style、旧 HTML marker 迁移、重复/破损 marker 拒绝。
- [x] 实现 `applyPreparedTransforms()`：全目标并发漂移复核、首次备份、changed-only 写入和结构化结果。
- [x] 为所有导出函数补中文 JSDoc；复杂校验写 Why 注释。
- [x] 用 Node 测试覆盖 insert/replace/remove、幂等、升级、marker style 迁移、严格 schema 类型、漂移、optional、路径越界、备份和非目标文本保留。

验证：

```bash
node --check src/lib/enhancement-transform.js
node --test test/js/enhancement-transform.test.js
```

回滚点：该步骤只新增独立模块和测试，尚未接入安装流水线。

### Step 3. 接入 apply pipeline 并修复 manifest 顺序

- [x] 在 `src/lib/apply-enhancements.js` 最前执行 transform preflight，任何 required 错误发生在复制、清理和 manifest 写入之前。
- [x] 应用 prepared transforms 后再走现有 copy/inject/tweak；把 `writeManifest()` 移到所有 required 强化步骤成功之后。
- [x] 保持 `--skills` 精细安装不写 manifest、不做 stale cleanup，只执行 alias 命中的 transform。
- [x] 扩展结构化控制台输出：changed/unchanged/missing/optional skipped 与 required 错误清单。
- [x] 增加 pipeline 测试，证明 preflight 失败不复制资产、不清 stale、不写 manifest，成功路径最后写 manifest。

验证：

```bash
node --check src/lib/apply-enhancements.js
node --test test/js/apply-enhancements.test.js
```

高风险点：manifest 后移改变全装恢复语义；检查旧 manifest 在中途失败后仍可让下一次运行收敛。

### Step 4. 在 skill-garden 0.6 定义 intent transforms

在 `vendor/skill-garden` 仓库完成真实源修改：

- [x] 新增 `overrides/transforms/intent-routing.json`。
- [x] 新增 `overrides/transforms/matches/`，保存当前 Trellis 0.6.5 的精确原文片段。
- [x] 新增 `overrides/transforms/content/`，保存 Phase 摘要、Request Triage、no_task、Phase 1 walkthrough、customization invariant、SessionStart、`trellis-start` 和 `trellis-brainstorm` 替换内容。
- [x] 所有 `.trellis/workflow.md` 与已存在 SessionStart hook 目标 required；各平台 skill/command/hook 显式目标在入口不存在时 missing-skip，入口存在但 selector 漂移时 required 失败。
- [x] 更新 `overrides/workflow.md`，加入精简的 Request Intent Routing 总则；不能复制 helper 状态机细节。
- [x] 删除旧 `overrides/workflow-states/no_task.md` additive sentinel，由 transform 生成唯一 no_task body。
- [x] 在 `src/lib/workflow-inject.js` 的 0.6 state specs 中移除 no_task additive 注入，保留 0.5/old 行为。
- [x] 让 skill-garden 独立 `install.sh` 通过标准库 Python consumer 使用同一份 transform 声明，并同步 `task_intent.py`。
- [x] 运行残留扫描，确认只消除 task-creation mechanical consent，不误删 brief/start/push/risk confirmation。

验证：

```bash
rg -n -i "task-creation consent|ask only whether this turn should create|ask whether you may create|ask the user if you can create" \
  .trellis/workflow.md .agents/skills .claude/skills .claude/commands .codex/hooks .claude/hooks
```

预期：不再命中 task 创建机械询问；必要确认用例仍由定向断言验证。

### Step 5. 实现 task intent helper

在 skill-garden 0.6 源新增 `scripts/task_intent.py`：

- [x] `create` 子命令调用现有 `task.py create`，解析返回 task 路径并写 `meta.intentRouting`。
- [x] 结构化捕获 Git HEAD 与 porcelain v1 `-z` dirty baseline，兼容 rename 和特殊文件名。
- [x] `discard` 子命令在零写入 preflight 中验证路径、autoCreated、session/request scope、planning、children/subtasks、commit/PR/worktree/progress 和 Git tracked/history。
- [x] 成功 discard 时按 parent → session → task 顺序精确删除；session/task 删除失败回滚已改 session 与 parent。
- [x] create 元数据读取/写入失败时补偿删除半成品 task；补偿不完整输出独立 rollback reason。
- [x] 拒绝分支输出稳定 JSON reason，且不提供 `--force`。
- [x] 在 `src/lib/copy-scripts.js` 为 `task_intent.py` 增加 `intent-routing`、`task-intent`、`workflow-enhancement` aliases。
- [x] 用 Python `unittest` 覆盖 create/baseline、元数据失败回滚、全部拒删条件、成功删除、parent/session/task rollback、路径穿越和业务 dirty 保留。

验证：

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/task_intent.py
python3 -m unittest discover -s test/python -p 'test_*.py'
```

高风险点：测试必须在临时仓库执行，禁止对当前真实 task 调用 discard。

### Step 6. 同步 snapshot 与当前 dogfood

- [ ] 先在 `vendor/skill-garden` 提交并推送 `beta` 源修改，记录 commit。
- [x] 在 flower-trellis 运行 `npm run sync`，生成 `enhancements/0.6` 与新 `MANIFEST.json`。
- [x] 更新 `scripts/sync-enhancements.mjs` 的 transform 声明/资源统计。
- [x] 用本地 flower 执行 enhance-only dogfood，使 `.trellis/workflow.md`、已存在的 `.agents/.claude` skill/command/SessionStart hook 与 helper 同步。
- [ ] 检查 flower 父仓只记录已提交的 submodule pin，不允许 vendor dirty。
- [x] 验证 0.5/old snapshot 除 `MANIFEST.json.syncedAt/sourceCommit` 外无内容漂移；如 sync 产生元数据变化，在 diff 中明确说明。

验证：

```bash
npm run sync
node scripts/check-snapshot.mjs
git -C vendor/skill-garden status --short
git submodule status vendor/skill-garden
git diff -- enhancements/0.5 enhancements/old
```

回滚点：若 dogfood 结果不符合声明，使用 `.trellis/.backup-flower/` 首次备份恢复，再修源和执行器；禁止直接手改生成快照掩盖问题。

### Step 7. 建立 AI context budget checker

- [x] 新增 `scripts/check-ai-context-budget.mjs`，测量完整 workflow、hub、每个 state、state 合计、Phase summary 和 fixture SessionStart control-plane。
- [x] 默认模式按 target/review ceiling 输出 `ok/warn/high-warning`，大小超限不导致非零退出。
- [x] 测量失败、fixture 缺失/损坏、目标缺失和输出不可解析必须失败。
- [x] 增加显式 `--strict`：仅发布审计使用，超过 review ceiling 时失败。
- [x] 将默认 checker 接入 `npm test`，strict 不接默认测试。
- [x] 测量结果同时打印 bytes、lines、相对基线差异；不输出不稳定 token 估算。
- [x] 用 Node 边界测试覆盖 ok/warn/high-warning，以及默认模式不硬失败、strict 仅对 high-warning 失败。

验证：

```bash
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
```

如果 strict 因当前已知基线超过 review ceiling，先减少重复上下文；不能直接调高阈值消除结果。

### Step 8. 沉淀两份独立 spec

- [x] 新增 `.trellis/spec/flower-trellis/cli/trellis-injection-transforms.md`，记录 schema、preflight、marker、备份、optional/required、pipeline、兼容、同步、测试和错误矩阵。
- [x] 新增 `.trellis/spec/flower-trellis/cli/ai-context-budget.md`，记录分层职责、2026-07-18 基线、target/review ceiling、默认告警、strict、去重规则和检查命令。
- [x] 更新 `enhancements-model.md`，保留 apply pipeline 摘要并链接 transform spec，避免复制整份协议。
- [x] 更新 CLI `index.md`、`quality-guidelines.md`、`directory-structure.md` 与必要的 release/snapshot 说明。
- [x] 用 `spec_router.py` 查询“修改 Trellis 注入”和“增加 AI workflow 上下文”时，两个新 spec 都能被正确匹配。

验证：

```bash
python3 ./.trellis/scripts/spec_router.py "修改 skill-garden 对 Trellis workflow skill command hook 的 replace remove insert 注入"
python3 ./.trellis/scripts/spec_router.py "增加 SessionStart workflow-state skill 注入内容并检查上下文大小"
```

### Step 9. 全量检查

- [x] 执行所有自动测试、语法检查和 dogfood 幂等检查；snapshot 发布检查将在 vendor 提交并更新 pin 后完成。
- [x] 在临时 Trellis 0.6.5 目标验证 fresh apply、旧 additive 升级、重复 apply、required drift、optional missing platform。
- [x] 比较第一次和第二次 apply 的 Git diff，第二次不得新增 diff。
- [x] 验证自动 task 创建只进入 planning；切换“不要任务”在安全条件满足时删除 task，在任一阻断条件下零副作用拒绝。
- [x] 验证 discuss/inspect 静默，task_plan/direct_edit/switch 只显示一行说明。
- [x] 验证 brief/start/route/check/push/finish-work 和高风险确认文案仍存在。

### Step 10. Check-All 修复批次

- [x] `CHK-001`：把 Codex/Claude SessionStart 纳入 skill-garden required hook transform，并移除机械 task consent。
- [x] `CHK-002`：在 workflow/brainstorm 中实际调用 `task_intent.py create`，在 hub/planning state 中实际调用 `discard`。
- [x] `CHK-003`：让 `task-intent`、`intent-routing` 精细安装同时命中 transform、helper、spec router 与 workflow hub。
- [x] `CHK-004`：独立 `--scope all` 在任何 common/Trellis 资产复制前完成 0.6 required preflight。
- [x] `CHK-005`：JS/Python consumer 对 schema 类型、alias、optional skip reason 和 marker style 保持一致。
- [x] `CHK-006`：create/discard 中途失败执行 session/parent/task 补偿回滚，并增加故障注入测试。
- [x] `CHK-007`：清理过期注释与 spec 列表缩进。
- [x] 修复后执行全量验证与 Check-All 只读重检。

命令集合：

```bash
npm test
node --check src/cli.js
for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/task_intent.py
python3 -m py_compile enhancements/0.6/scripts/task_intent.py
python3 -m py_compile .trellis/scripts/task_intent.py
python3 -m py_compile .codex/hooks/session-start.py .claude/hooks/session-start.py
npm run sync
node scripts/check-snapshot.mjs
git diff --check
```

## 2. 预计修改范围

### skill-garden 仓库

- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/no_task.md`（删除）
- `vendor/skill-garden/.trellis/0.6/overrides/transforms/**`
- `vendor/skill-garden/.trellis/0.6/scripts/task_intent.py`
- `vendor/skill-garden/scripts/apply-trellis-transforms.py`
- `vendor/skill-garden/scripts/install.sh`

### flower-trellis 源与测试

- `src/lib/enhancement-transform.js`
- `src/lib/apply-enhancements.js`
- `src/lib/workflow-inject.js`
- `src/lib/copy-scripts.js`
- `scripts/sync-enhancements.mjs`
- `scripts/check-ai-context-budget.mjs`
- `package.json`
- `test/js/**`
- `test/python/**`

### 生成快照与 dogfood

- `enhancements/0.6/**`
- `enhancements/MANIFEST.json`
- `.trellis/workflow.md`
- `.trellis/scripts/task_intent.py`
- 已存在的 `.agents/.claude` `trellis-start` / `trellis-brainstorm` 副本

### Spec

- `.trellis/spec/flower-trellis/cli/trellis-injection-transforms.md`
- `.trellis/spec/flower-trellis/cli/ai-context-budget.md`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`
- `.trellis/spec/flower-trellis/cli/quality-guidelines.md`
- `.trellis/spec/flower-trellis/cli/directory-structure.md`
- `.trellis/spec/flower-trellis/cli/index.md`

## 3. 提交与推送顺序

1. skill-garden：提交 0.6 transforms、hub 与 helper，推送 `beta`。
2. flower-trellis：更新 submodule pin，提交执行器、测试、snapshot、dogfood、spec 和任务产物，推送 `beta`。
3. 不允许反向顺序；flower commit 引用的 skill-garden commit 必须已在远端可达。

## 4. Start 前检查

- [x] PRD 无 open questions，D1-D10 全部进入权威需求。
- [x] `design.md` 与 `implement.md` 已由用户审阅。
- [x] `implement.jsonl`、`check.jsonl` 均含真实 spec 条目，无 `_example`。
- [x] `brief.md` 已由 `trellis-task-brief` 生成并在对话展示。
- [x] 用户确认后才运行 `task.py start`；随后先执行 `trellis-route(implement)`。
