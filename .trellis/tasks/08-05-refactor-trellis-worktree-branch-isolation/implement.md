# 重构 Trellis worktree 分支隔离 - Implement

## Checklist

1. 建立新状态契约：
   - 更新 `config-and-state.md` 的 worktree scenario，废弃跨 worktree projection。
   - 定义 local readiness、legacy migration、common registry 和 CLI JSON schema。
2. 重构 Python worktree engine：
   - 把 `worktree_setup.py` 从 `sourceRoot + ENTRY_PATHS + symlink` 改为 target-local 状态机。
   - 新增 git-dir/common-dir/worktree ID、平台检测、registry 原子读写和锁。
   - 保留 schema v1 只读诊断，新增事务化 `migrate`。
3. 移除跨分支 runtime fallback：
   - 删除 `untracked_flow.py` 的其它 worktree 根回退。
   - 更新 workflow-state hook Patch，在 cwd 缺本地 `.trellis` 时返回稳定诊断。
4. 新增 Flower CLI facade：
   - 在 `src/cli.js` / `src/lib/cli-args.js` 注册 `worktree` 自有命令和 help。
   - 新增 `src/commands/worktree.js`，调用随包 Python engine并编排 init/update/Plugin replay。
   - 复用 `trellis-python-command.js`、现有 target 解析、事务补偿和 CLI 输出规范。
5. 实现 create/remove 生命周期：
   - create preflight 校验 branch/path/base/registry，创建 worktree 后准备本地 Trellis。
   - 在目标目录创建 planning task并写 branch，最后提交 registry 与 handoff 输出。
   - 任一步失败逆序撤销本轮新增 task/worktree/branch/registry；不得影响预先存在对象。
   - remove 校验 clean、task status、session/lock 和 registry 后移除 worktree，保留 branch。
6. 更新 `trellis-worktree` skill：
   - 优先使用 `flower-trellis worktree status`；删除 source worktree discovery 和 symlink 指令。
   - 明确 ready-local / needs-init / needs-migration / blocked 路由与新会话 handoff。
7. 同步 authoring/compiled targets：
   - 修改 `vendor/skill-garden/.trellis/0.6/` 源和 Patch。
   - 运行 Patch target refresh、`npm run sync`，核对 `enhancements/0.6/` 与 dogfood 副本。
8. 补充测试：
   - Python helper 状态、registry、锁、迁移事务和 fallback 删除测试。
   - Node CLI parse/dispatch、Python facade、create/remove 补偿测试。
   - 两个不同分支 workflow/spec/platform 内容的真实 linked worktree 回归。
   - legacy v1 symlink 成功迁移、不可重建、用户冲突和幂等回归。
9. 运行完整检查并根据结果修复规范或实现漂移。

## Validation Commands

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/untracked_flow.py
python3 -m unittest discover -s test/python -p 'test_worktree_setup.py'
python3 -m unittest discover -s test/python -p 'test_untracked_flow.py'
python3 -m unittest discover -s test/python -p 'test_workflow_state_hook.py'
node --check src/cli.js
node --check src/lib/cli-args.js
node --check src/commands/worktree.js
node --test test/js/worktree-cli.test.js
npm run patch:targets
npm run sync
npm run patch:targets:check
npm test
git diff --check
git -C vendor/skill-garden diff --check
```

## Risk And Rollback Points

- 不能在 legacy migration 中读取旧 sourceRoot 作为新 branch-local 内容来源。
- 不能让 create 失败后误删预先存在的 branch、目录、task 或 registry 记录。
- 不能把 common registry 当成 task 状态真相；Git 和目标 task 文件始终优先。
- 不能把 active-task/session runtime 直接迁到全仓共享路径，否则相同 context key 会跨 worktree 污染。
- 不能只删除 helper symlink 逻辑而保留 hook/untracked fallback，否则仍会执行其它分支 workflow。
- 不能让 `worktree` 子命令落入 `src/cli.js` 的上游 Trellis透传分支。
- 不能只改 Flower dogfood 文件；先改 Skill-Garden authoring source，再刷新 Patch 和快照。
- 若 common registry 或迁移事务无法在所有目标平台可靠加锁，首版应降级为检测并阻断并发写，
  不得用无锁 last-write-wins。

## Handoff Check

- 复读 PRD 与 Design，确认没有重新引入跨 worktree 内容共享。
- 确认 JSONL context 含 CLI 状态规范、enhancement/Patch 规范和本任务 research。
- 刷新 Brief 并获得用户明确批准后，才运行 `task.py start`。
