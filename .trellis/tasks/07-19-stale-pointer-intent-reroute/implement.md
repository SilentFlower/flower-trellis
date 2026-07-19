# stale pointer 后任务意图重路由实施计划

## 1. 实施步骤

### Step 1. 建立 stale workflow-state Patch

- [x] 在 `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/state-missing-task/` 新增 schema v2 Patch。
- [x] 使用 `literal insert after` 在唯一 `[/workflow-state:no_task]` 后插入完整 `missing_task` 标签块。
- [x] 恢复正文只表达清理、失败停止、成功后同轮进入 `no_task` 路由和分类前禁止编辑/建任务，不复制完整意图规则。
- [x] 把 Patch 引用加入 `intent-routing` Bundle。

验证：

```bash
node --test test/js/apply-enhancements.test.js
```

回滚点：本步骤只新增声明式 Patch；删除新 leaf 与 Bundle 引用即可回退。

### Step 2. 归一 shared Hook stale 状态并扩展平台目标

- [x] 把当前 beta.2 `content.py` 原样保存为历史 baseline。
- [x] 修改 shared Hook `get_active_task()`，让所有 `active.stale` 返回 `status=missing_task`，保留 `task_id` 与 `source`。
- [x] 更新 whole-file Patch baselines，使上游 0.6.5 原始 Hook、beta.2 旧强化 Hook和新 desired-content 都可确定性收敛。
- [x] 把 targets 扩展到 Claude、Codex、Gemini、Qoder、Copilot、CodeBuddy、Droid、Kiro、Trae 的实际 per-turn Hook 路径；全部 `missing=skip`，不加入 Cursor。
- [x] 把 shared runtime Patch 加入 `intent-routing` Bundle，同时保留 `shared-hook-runtime` full-only Bundle。

验证：

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/content.py
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
```

高风险点：不能直接覆盖未知 whole-file 内容；旧 Flower 产物必须靠显式 baseline 升级。

### Step 3. 更新 Codex / Claude SessionStart stale 提示

- [x] 新增 Codex stale literal Patch，替换现有 `STALE POINTER` 返回正文。
- [x] 新增 Claude stale literal Patch，移除“then ask the user what to work on next”，改为清理后同轮按 `no_task` 分类当前请求。
- [x] 两个平台都明确：清理失败停止；分类前禁止编辑、创建任务或 `task.py start`。
- [x] 目标继续 `missing=skip`，不创建其它平台 SessionStart 文件。
- [x] 把两个 Patch 加入 `intent-routing` Bundle。

验证：

```bash
node --test test/js/apply-enhancements.test.js
python3 -m py_compile .codex/hooks/session-start.py .claude/hooks/session-start.py
```

### Step 4. 增加行为与安装回归测试

- [x] 新增 shared Hook Python 测试，覆盖 stale `session` 与 `session-fallback` 归一、权威 breadcrumb 加载和普通状态不回归。
- [x] 扩展 `minimalWorkflow()` 与 intent target fixture，包含 stale state selector、两个 SessionStart stale selector和九个平台 shared Hook baseline。
- [x] fresh full apply 断言 workflow、shared Hook、SessionStart、provenance 与未启用平台边界。
- [x] 构造 beta.2 旧强化 Hook 目标，验证 whole-file 升级而非 fingerprint drift。
- [x] 两个精细 alias 都验证完整 stale 修复并重复运行幂等。
- [x] 更新 Python real catalog preflight / selected alias 断言，保持 JS/Python consumer parity。

验证：

```bash
node --test test/js/apply-enhancements.test.js
python3 -m unittest discover -s test/python -p 'test_workflow_state_hook.py'
python3 -m unittest discover -s test/python -p 'test_skill_garden_patches.py'
```

### Step 5. 同步 snapshot 与当前 dogfood

- [x] 运行 `npm run sync` 生成 `enhancements/0.6`，不手改生成快照。
- [x] 直接调用本仓 `applyEnhancements()` 更新 workflow 和现有 Codex/Claude Hook，避免 `update` 命令额外同步全局 Trellis。
- [x] 核对 Patch provenance，确认新增 operation 被记录且重复应用稳定。
- [x] 比较 vendor、snapshot、dogfood 的 stale state、shared Hook 与 SessionStart 内容。
- [x] 确认 0.5、old 和 `node_modules/@mindfoldhq/trellis` 没有内容改动。

验证：

```bash
npm run sync
node --input-type=module -e 'import { applyEnhancements } from "./src/lib/apply-enhancements.js"; applyEnhancements(process.cwd(), { variant: "0.6" });'
node scripts/check-snapshot.mjs
git diff -- enhancements/0.5 enhancements/old
```

回滚点：若 dogfood 结果异常，使用 `.trellis/.backup-flower/` 的首次备份恢复目标文件，修正源 Patch 后重新 sync/apply；不直接修改快照掩盖问题。

### Step 6. 更新架构规范

- [x] 在 `enhancements-model.md` 增加 stale pointer intent recovery 场景，记录稳定状态、同轮 `no_task` 重分类、shared 平台目标、SessionStart 边界和 whole-file 历史 baseline 要求。
- [x] 保持 Patch Engine 通用协议不变，不为本功能新增平行注入机制。
- [x] 用 `spec_router.py` 验证“stale pointer / workflow state hook / 任务意图重路由”能命中相关规范。

### Step 7. 全量验证与 Check-All

- [ ] 运行 JS/Python 全量测试和所有相关语法检查。
- [ ] 运行 Patch conflict、snapshot、默认/strict AI context budget 和 `git diff --check`。
- [ ] 在临时目标验证 fresh apply、beta.2 升级、精细安装、重复 apply 和缺平台 skip。
- [ ] 进入 `trellis-route(target=check)`，由 Check-All 根据 workflow/hook 控制面风险执行 full 深度只读审查。
- [ ] 用户确认修复项后再处理 Check-All 发现的问题并重新检查。

命令集合：

```bash
npm test
python3 -m py_compile vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/content.py
python3 -m py_compile enhancements/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/content.py
python3 -m py_compile .codex/hooks/inject-workflow-state.py .claude/hooks/inject-workflow-state.py
python3 -m py_compile .codex/hooks/session-start.py .claude/hooks/session-start.py
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
node scripts/check-snapshot.mjs
git diff --check
```

## 2. 预计修改范围

### Skill-Garden 真实源

- `vendor/skill-garden/.trellis/0.6/overrides/bundles/intent-routing.json`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/state-missing-task/**`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/**`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/codex-session-start/missing-task-routing/**`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/claude-session-start/missing-task-routing/**`

### Flower 源、测试与规范

- `test/js/apply-enhancements.test.js`
- `test/python/test_skill_garden_patches.py`
- `test/python/test_workflow_state_hook.py`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`

### 生成快照与 dogfood

- `enhancements/0.6/overrides/**`
- `enhancements/MANIFEST.json`
- `.trellis/workflow.md`
- `.codex/hooks/inject-workflow-state.py`
- `.claude/hooks/inject-workflow-state.py`
- `.codex/hooks/session-start.py`
- `.claude/hooks/session-start.py`
- `.trellis/.flower-manifest.json`

## 3. Review Gates

- [x] `prd.md`、`design.md`、`implement.md` 无 open questions，范围与用户确认一致。
- [x] `implement.jsonl`、`check.jsonl` 均为真实规范条目，无 `_example`。
- [x] `brief.md` 已由 `trellis-task-brief` 生成并在对话展示。
- [x] 用户确认 brief 后才运行 `task.py start`。
- [x] 实现阶段先进入 `trellis-route(target=implement)`，不直接绕过路由。
- [ ] 完成实现后进入 full Check-All，修复范围再次由用户确认。
