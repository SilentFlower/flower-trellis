# 调整 trellis-push snapshot bookkeeping 脏工作区规则 - 设计

## Technical Design

本任务采用文档协议级调整，不新增运行时代码。

### 1. Snapshot 前置状态记录

在 Step 1 预检时，如果后续计划写 snapshot，需要记录父仓当前状态，但用途从“发现任何额外 dirty 就阻塞”改为：

- 识别是否存在未合并/冲突状态。
- 识别是否存在与本次 bookkeeping 无关的 staged 文件。
- 识别目标 `<task_dir>/task.json` 是否在写入前已经 dirty。
- 记录无关未暂存 dirty 文件，用于最终提示，但不阻塞。

### 2. 写入 snapshot 的允许条件

允许：

- 父仓存在无关未暂存 dirty 文件。
- 这些文件未被用户确认纳入本次 bookkeeping，也不会被本次 `git add` / commit 触碰。

阻塞：

- 父仓存在未合并路径、rebase/merge 冲突。
- 父仓已有与本次 bookkeeping 无关的 staged 文件。
- `<task_dir>/task.json` 在写入前已经 dirty，且该 dirty 不是当前计划已确认的 snapshot 写入。
- reconfigure 场景下 `.trellis/config.yaml` 在写入前已经有未确认 dirty，且未在统一计划中确认。

### 3. Bookkeeping commit 范围

提交命令应明确限定路径。推荐写法：

```bash
git add -- <task_json_path> [".trellis/config.yaml"]
git commit --only -- <task_json_path> [".trellis/config.yaml"] -m "chore(task): update <task_name> push snapshot"
```

如果本地 Git 对 `git commit --only -- <paths> -m` 参数顺序兼容性存在顾虑，也可以在文档中保留普通 commit，但前置条件必须保证没有无关 staged 文件：

```bash
git add -- <task_json_path> [".trellis/config.yaml"]
git commit -m "chore(task): update <task_name> push snapshot"
```

本任务推荐在 skill 文档中同时强调两点：优先使用路径限定 commit；执行前必须确认 staged 区只有本次 bookkeeping 文件。

### 4. 输出行为

如果存在无关未暂存 dirty 文件，结果中提示：

```text
父仓存在未提交的无关文件，已保留未暂存，snapshot commit 未包含它们：<list>
```

这类提示不应变成二次确认问题。

## Compatibility

- `last_push_snapshot` schema 不变。
- `trellis-push` 的统一确认计划仍是唯一常规确认点。
- 保留 `git add -A` / `git add .` 禁令。
- 保留“snapshot / config bookkeeping 不与业务 commit 混合”的边界。

## Rollout / Rollback

- Rollout：修改 `vendor/skill-garden/.trellis/0.6` 源 skill，复制到当前 `.agents` / `.claude`，运行同步脚本更新 `enhancements/0.6`。
- Rollback：回退上述 `trellis-push/SKILL.md` 副本和生成快照。
