# push snapshot helper 实施计划

## 实施步骤

1. 实现源脚本
   - 在 `vendor/skill-garden/.trellis/0.6/scripts/push_snapshot.py` 新增脚本。
   - 支持 `status` / `write` 两个子命令。
   - 复用现有 `.trellis/scripts/common` 的 active task 与 task path 思路，但脚本要能在目标项目根运行。

2. 更新 `trellis-push` 文案
   - 修改 vendor `.agents` 与 `.claude` 两份 `trellis-push/SKILL.md`。
   - Step 0.3 使用 `push_snapshot.py status --json` 读取旧 snapshot。
   - Step 5 使用 `push_snapshot.py write` 写入新 snapshot。
   - 保留用户确认和 git 安全门禁。

3. 瘦身 workflow recovery 文案
   - 修改 vendor `overrides/workflow.md` 的 `Push Progress Recovery / Snapshot` 段。
   - 修改 vendor `overrides/workflow-states/no_task.md`、`in_progress.md`、`in_progress-inline.md`。
   - hub 只保留 helper 入口和边界，state 只保留 breadcrumb。
   - 不修改 `workflow-inject.js`、`session-start.py`、`inject-workflow-state.py` 或 `trellis-continue`。

4. 更新脚本铺设逻辑
   - 修改 `src/lib/copy-scripts.js`。
   - 为 `push_snapshot` 增加精细安装别名：`push-snapshot`、`trellis-push`、`push`、`snapshot`。

5. 同步快照与 dogfood 副本
   - 运行 `npm run sync` 生成 `enhancements/0.6` 快照。
   - 将 vendor 脚本同步到当前 `.trellis/scripts/push_snapshot.py`。
   - 将 vendor `trellis-push/SKILL.md` 同步到当前 `.agents` / `.claude` 副本。
   - 使用 `workflow-inject` 更新当前 `.trellis/workflow.md` 中的 hub 和 workflow-state 注入块。

6. 配置任务上下文
   - 在 `implement.jsonl` / `check.jsonl` 加入相关 spec。
   - 删除或保留 seed row 均可，但必须存在真实条目。

## 验证命令

```bash
python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/push_snapshot.py
python3 -m py_compile enhancements/0.6/scripts/push_snapshot.py
python3 -m py_compile .trellis/scripts/push_snapshot.py
node --check src/lib/copy-scripts.js
npm run sync
diff -u vendor/skill-garden/.trellis/0.6/scripts/push_snapshot.py enhancements/0.6/scripts/push_snapshot.py
diff -u vendor/skill-garden/.trellis/0.6/scripts/push_snapshot.py .trellis/scripts/push_snapshot.py
diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md enhancements/0.6/.agents/skills/trellis-push/SKILL.md
diff -u vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md .agents/skills/trellis-push/SKILL.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow.md enhancements/0.6/overrides/workflow.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md enhancements/0.6/overrides/workflow-states/in_progress.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md enhancements/0.6/overrides/workflow-states/in_progress-inline.md
diff -u vendor/skill-garden/.trellis/0.6/overrides/workflow-states/no_task.md enhancements/0.6/overrides/workflow-states/no_task.md
```

行为验证建议：

```bash
python3 ./.trellis/scripts/push_snapshot.py status --task .trellis/tasks/07-01-push-snapshot-helper --json
python3 ./.trellis/scripts/push_snapshot.py write --task <临时任务> --snapshot-json '<合法 snapshot json>' --json
python3 ./.trellis/scripts/push_snapshot.py write --task <临时任务> --snapshot-json '{"bad": true}' --json
```

写入行为验证应使用临时任务或可回滚 fixture，避免污染真实任务进度。

## 回滚点

- `vendor/skill-garden/.trellis/0.6/scripts/push_snapshot.py`
- `enhancements/0.6/scripts/push_snapshot.py`
- `.trellis/scripts/push_snapshot.py`
- `trellis-push/SKILL.md` 各副本
- `workflow.md` / `workflow-states` 覆写与当前 `.trellis/workflow.md`
- `src/lib/copy-scripts.js`
