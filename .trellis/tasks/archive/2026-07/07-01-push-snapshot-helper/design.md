# push snapshot helper 设计

## 目标与边界

本任务把 `last_push_snapshot` 的机械 JSON 读写从 `trellis-push` 文案中抽成一个窄接口脚本。脚本只处理 snapshot 字段本身；`trellis-push` 仍负责提交计划、用户确认、git 安全门禁、commit / push / merge、以及 snapshot 语义内容的生成。

明确不改以下入口：

- `session-start.py`
- `inject-workflow-state.py`
- `trellis-continue`

## 文件位置

源头改动：

- `vendor/skill-garden/.trellis/0.6/scripts/push_snapshot.py`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/{no_task,in_progress,in_progress-inline}.md`
- `src/lib/copy-scripts.js`

同步产物：

- `enhancements/0.6/scripts/push_snapshot.py`
- `enhancements/0.6/.agents/skills/trellis-push/SKILL.md`
- `enhancements/0.6/.claude/skills/trellis-push/SKILL.md`
- `enhancements/0.6/overrides/workflow.md`
- `enhancements/0.6/overrides/workflow-states/{no_task,in_progress,in_progress-inline}.md`
- `.trellis/workflow.md`
- `.trellis/scripts/push_snapshot.py`
- `.agents/skills/trellis-push/SKILL.md`
- `.claude/skills/trellis-push/SKILL.md`

## CLI 接口

```bash
python3 ./.trellis/scripts/push_snapshot.py status [--task <task-dir>] [--json]
python3 ./.trellis/scripts/push_snapshot.py write --task <task-dir> --snapshot-json '<json>' [--json]
```

默认输出为简短文本，`--json` 输出结构化 JSON。

### status

输入：

- 可选 `--task <task-dir>`。

行为：

1. 如果传入 `--task`，解析该任务目录并读取 `<task>/task.json.last_push_snapshot`。
2. 如果没有传入 `--task` 且存在 active task，读取 active task 的 snapshot。
3. 如果没有 active task，扫描 `.trellis/tasks/*/task.json`，返回 `status="in_progress"` 且包含 `last_push_snapshot` 的候选。
4. 不自动设置 active task，不写 runtime。

建议 JSON 输出：

```json
{
  "status": "ok",
  "task": ".trellis/tasks/07-01-example",
  "snapshot": {
    "completed_steps": ["..."],
    "partial_step": "...",
    "next_step": "..."
  }
}
```

无 active task 候选输出：

```json
{
  "status": "candidates",
  "candidates": [
    {
      "task": ".trellis/tasks/07-01-example",
      "completed_steps": ["..."],
      "partial_step": "...",
      "next_step": "..."
    }
  ]
}
```

无 snapshot 时输出 `status="no-snapshot"`。

### write

输入：

- 必填 `--task <task-dir>`。
- 必填 `--snapshot-json '<json>'`。

行为：

1. 解析任务目录。
2. 读取 `<task>/task.json`。
3. 校验 snapshot schema。
4. 只更新 `last_push_snapshot` 字段。
5. 用 2 空格缩进写回 JSON，保留其他字段和值。
6. 输出写入摘要。

## Schema 校验

必填字段：

- `snapshot_at`: string
- `branch`: string 或 object
- `pushed_commits`: string 或 object
- `completed_steps`: array of string
- `next_step`: string

可选字段：

- `partial_step`: string
- `notes`: string

拒绝规则：

- snapshot 不是 JSON object。
- 必填字段缺失。
- 字段类型明显不合法。
- `completed_steps` 不是字符串数组。

不做的校验：

- 不校验 commit hash 是否存在。
- 不校验 branch 是否是当前分支。
- 不校验 next_step 是否属于某个固定 phase。
- 不校验 git 状态。

这些仍由 `trellis-push` 的执行计划和安全门禁处理。

## trellis-push 接入

`trellis-push` Step 0.3 改为建议调用：

```bash
python3 ./.trellis/scripts/push_snapshot.py status --json
```

`trellis-push` Step 5.1 改为在补齐运行后字段后调用：

```bash
python3 ./.trellis/scripts/push_snapshot.py write --task <task-dir> --snapshot-json '<confirmed-runtime-json>'
```

确认门禁不变：用户确认前不得写 task.json。

## workflow / workflow-state 文案

`workflow.md` 的 `Push Progress Recovery / Snapshot` 段保留三类信息：

- recovery 读取和 `trellis-push` 写入都走 `push_snapshot.py`。
- `trellis-push` 仍负责语义、用户确认、git 操作和运行后字段。
- recovery 只 relay helper 输出，不自动 rebind、不推断 phase、不接入 SessionStart / workflow-state injection / `trellis-continue`。

`workflow-states` 只保留 breadcrumb：

```text
Push snapshot recovery: follow the hub; use `push_snapshot.py status --json` only when needed.
```

这样每轮注入只提示入口和边界，机械扫描、schema 和写入细节下沉到 helper / `trellis-push` skill。

## 安装与同步

- `push_snapshot.py` 放入 0.6 `scripts/`，由 `npm run sync` 进入 `enhancements/0.6/scripts/`。
- `src/lib/copy-scripts.js` 为 `push_snapshot` 增加别名：`push-snapshot`、`trellis-push`、`push`、`snapshot`。
- 全装时自然铺设该脚本；精细安装 `--skills trellis-push` 时也应铺设。
- 0.6 workflow 覆写先改 `vendor/skill-garden/.trellis/0.6/overrides/`，再 `npm run sync` 到 `enhancements/0.6/overrides/`，当前 dogfood `.trellis/workflow.md` 通过 `workflow-inject` 生成。

## 风险与回滚

风险：

- `trellis-push` 文案和脚本接口不一致会导致执行时卡住。
- schema 过严可能拒绝历史兼容 snapshot。
- 多副本同步遗漏会导致 dogfood、vendor、enhancements 漂移。
- workflow hub / state 文案如果重新展开机械细节，会增加高频注入负担并诱导 AI 绕过 helper。

回滚：

- 删除 `push_snapshot.py`。
- 回退 `trellis-push/SKILL.md` 中对 helper 的调用。
- 回退 `copy-scripts.js` 的别名。
- 重新运行 `npm run sync` 恢复快照一致性。
