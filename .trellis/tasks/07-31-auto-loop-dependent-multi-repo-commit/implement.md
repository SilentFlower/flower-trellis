# Auto-Loop 依赖型多仓提交最小实施计划

## 1. Preparation

1. 读取本任务 `prd.md`、`design.md`、curated JSONL 和匹配 spec。
2. 核对当前 Flower 与 `vendor/skill-garden` 分支、HEAD、staged 和 dirty；保留遥测/SLS 的 post-auto-loop `task.json` 以及本任务规划文件。
3. 以刚完成的 SLS run `auto-20260730175312` 为回归证据，确认目标是自动复现已成功的现有能力，而不是引入新执行器。

## 2. Runner Minimal Changes

1. 修改 canonical `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`：
   - 为 `record` 增加可重复 `--repo-commit <repository>::<hash>`。
   - 增加仓库根、commit hash、commit object 和重复项校验。
   - item 增加可选 `commits[]`，保留现有 `commit` 字段。
   - 成功、failed 和 blocked commit-only 都保存已完成 commits。
   - 为 `commit-repairable` 增加 `attempts.commit_repair`，前三次失败重新发出同名 `commit_only` action，第 4 次失败进入 blocked。
   - 预算耗尽时写 `commit-repair-budget-exhausted`；`retry-blocked` 重置预算但保留 commits。
   - 更新 status、resume capsule、decision summary 和 task progress 的多 commit 展示。
2. 不增加新子命令、不增加新的 `record` result、不提升 schema version、不执行 Git 或生成命令。
3. 所有新增公共 Python 函数补齐中文 Docstring；对安全分类和兼容逻辑添加必要的中文原因注释。

## 3. Skill Contract Changes

1. 更新 canonical `trellis-auto-loop/SKILL.md`：
   - commit-only 可以调用 `trellis-push` 的多仓本地执行路径。
   - 不得因多个仓库、submodule pin 或证据充分的本地生成命令直接返回 `multi-repo-commit-boundary`。
   - repairable 失败回写已完成 commits，并在 runner 重新发出 action 后从真实 Git 状态恢复。
   - 最终成功 record 传主 commit、全部 repo commits、exact files 和 retained files。
2. 更新 canonical `trellis-push/SKILL.md`：
   - auto-loop 内部 commit-only 复用普通多仓的仓库发现、顺序执行、生成命令和失败保留逻辑，但不确认、不 push，也不执行 `trellis-push` Step 5 的任务进度写入、进度 commit 或 progress push；Auto-Loop runner 仍按自身契约写入本地 `task.json.progress`。
   - 根据任务 artifacts、SOP/spec、受版本控制脚本和明确 Git/输入输出关系进行受约束推断。
   - retained dirty 可存在，但必须记录并验证摘要不变，且不能与 generated/planned paths 冲突。
   - 明确安全自修复与直接 blocked 的失败分类。
3. 同步 `.claude/skills/` 对应副本，保持字节或语义一致。

## 4. Tests

1. 扩展 `test/python/test_auto_loop.py`：
   - 旧单仓 `record --commit` 与 progress 文案保持兼容。
   - 多个 `--repo-commit` 成功后保存并展示全部仓库 hash，`commit` 仍为主 commit。
   - 未登记仓库、非法 hash、不可解析 commit 和同仓冲突 hash 被拒绝。
   - `commit-repairable` 保存部分 commits，前三次失败重新发出 `commit_only`。
   - 第 4 次失败进入 `commit-repair-budget-exhausted`，`retry-blocked` 重置预算但保留 commits。
   - 非 repairable commit-only 仍立即 blocked。
2. 扩展 JS 静态契约测试：
   - Auto-Loop/Push 双平台副本明确支持内部多仓 commit-only 和中间本地生成。
   - 禁止 `multi-repo-commit-boundary` 作为仅因多仓产生的终态。
   - 固定受约束推断、retained 摘要校验、三轮自修复和 no-push 边界。
3. 使用临时 Git fixture 模拟两个仓库：
   - 前置仓 commit 已存在时重规划并跳过。
   - 本地生成第一次失败、第二次成功时完成后续仓提交。
   - 生成产生计划外 dirty 或 retained 漂移时停止后续提交。
   - fixture 不访问网络、不使用真实 SLS dirty、不修改当前仓库历史。

## 5. Sync And Dogfood

1. 修改 Skill Garden canonical 后运行 `npm run sync`，检查只更新预期的 `enhancements/0.6` 与 manifest。
2. 同步当前 dogfood `.trellis/scripts/auto_loop.py`、`.agents` 和 `.claude` Skills。
3. 使用 dogfood runner 在临时双仓 fixture 中演练完整 chain 和 repairable retry。
4. 保留当前未提交的两个任务进度 `task.json`，不得把它们混入本任务实现提交。

## 6. Validation

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py
python3 -m unittest discover -s test/python -p 'test_auto_loop.py'
node --test test/js/workflow-gate-ownership.test.js test/js/update-spec-auto-decision.test.js
npm test
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
node scripts/check-ai-context-budget.mjs
git -C vendor/skill-garden diff --check
git diff --check
```

额外反向检查：

- 搜索 `multi-repo-commit-boundary`，确认不会仅因多仓/生成链而 blocked。
- 搜索 auto-loop 内部 `commit-only` 文案，确认不再限制成单个 commit。
- 搜索 `snapshot_commit`，确认没有用它承载第二仓 commit。
- 搜索 `commit-plan` / `commit-step`，确认未引入新命令或残留旧规划契约。
- 比较 canonical、`enhancements/0.6` 和 dogfood runner/Skill 副本。

## 7. Spec Update

1. 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的 Auto-Loop commit-only 契约：动态多仓、受约束推断、retained 校验、有限自修复和多 commit 结果。
2. 检查 `flower-plugin-runtime.md` 与 `trellis-patch-engine.md`；只有发现新的稳定所有权变化时最小更新。
3. 不把 SLS 特例、具体仓库名称或 `npm run sync` 写成通用协议硬编码。

## 8. Risk And Rollback

- `auto_loop.py`：只增加可选结果字段和 commit repair 分支，必须保持其它 action 状态机不变。
- `trellis-auto-loop/SKILL.md`：不得扩大 commit-only 到 push、发布或任意命令。
- `trellis-push/SKILL.md`：仍是唯一 Git owner，runner 不复制其预检逻辑。
- `enhancements/0.6/**` 与 dogfood 副本：必须从 canonical 同步，禁止手工漂移。

回滚时移除 `--repo-commit`、`commits[]` 和 commit repair 分支，恢复两个 Skill 的单仓措辞并重新同步；不撤销任何已创建的业务 commit。
