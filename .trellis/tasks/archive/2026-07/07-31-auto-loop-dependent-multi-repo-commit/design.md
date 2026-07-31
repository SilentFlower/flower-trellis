# Auto-Loop 依赖型多仓提交最小设计

## 1. Problem Restatement

Auto-Loop 已经能把任务推进到 `commit_only`，`trellis-push` 也已经能执行多仓提交和中间本地生成。实际缺口是两个 Skill 把 auto-loop 内部 commit-only 解释成“只执行一个精确提交”，导致遇到非原子多仓链时提前 blocked。

SLS 任务已经证明现有能力可以闭环：

```text
Skill Garden 321bcc1
  -> npm run sync
  -> Flower b8c611f
  -> auto_loop.py record commit_only ok
  -> auto_loop.py next
  -> run completed
```

因此本任务不引入新的步骤协议。设计目标是让同一条现有链自动发生，并补齐多个 commit 的结构化结果与有限自修复。

## 2. Ownership

- `trellis-push`：发现仓库、形成动态执行链、执行逐仓 Git 预检和精确提交、运行证据充分的本地生成命令、生成后重新规划。
- `trellis-auto-loop` Skill：解释 commit-only 预授权、要求自动执行而不是因多仓边界 blocked、定义安全重试和最终 record 顺序。
- `auto_loop.py`：保存多个 commit、重试次数和终态摘要；不执行 Git，不执行生成命令，也不验证业务级依赖图。

## 3. Dynamic Execution Chain

`trellis-push` 在每次 `commit_only` action 中从当前现场重新生成有序操作链：

```text
commit(repo-a)
  -> generate(repo-b, argv)
  -> commit(repo-b)
  -> generate(repo-c, argv)
  -> commit(repo-c)
```

仓库和步骤数量不设固定上限，但每一步必须有可审计依据。

### 3.1 Evidence Sources

按以下优先级收集：

1. 当前任务 `design.md` / `implement.md` 的明确顺序、命令和路径。
2. 项目 SOP/spec 的 canonical、生成和发布约定。
3. 受版本控制的 `package.json`、Makefile 或仓库脚本入口，以及脚本中可确认的输入输出路径。
4. 可验证的 Git 关系，例如独立 submodule 必须先提交子仓，父仓随后记录 gitlink。

允许 AI 组合这些证据推导执行链，但不能仅凭名称相似、mtime、目录邻近或习惯猜测。

### 3.2 Command Boundary

- 命令必须落到受版本控制的稳定入口，例如 `npm run sync`，而不是临时拼接 shell。
- 工作目录必须位于已发现仓库内。
- 命令必须本地、确定性、可重复且无外部副作用。
- 禁止管道、重定向、命令替换、push、release、deploy、archive、凭证和生产数据操作。
- 无法证明安全时，直接把当前 item 标记 blocked，不降低门禁。

## 4. Existing Git Safety Reuse

多仓 auto-loop commit-only 复用 `trellis-push` 已有行为：

1. 执行前检查 branch、HEAD、冲突、未完成集成、staged、planned 和 retained。
2. 使用 exact path 暂存和 `git commit --only`，禁止 `git add .` / `git add -A`。
3. 每个 commit 后验证实际提交文件集合。
4. 生成命令后重新读取全部 dirty paths；内容、hash 和统计可变化，但路径必须可归属于后续 planned 或保持为原 retained。
5. 多仓中途失败时停止后续副作用，保留已成功 commit，不自动回滚。

现有“后续仓存在 retained dirty 就不能运行生成命令”收紧为：retained 可以存在，但必须在生成前记录摘要，生成后保持不变，且与 generated/planned paths 不冲突。刚完成的 SLS 链就是该场景：Flower 同时保留其它任务 dirty，但 exact 提交仍然安全。

## 5. Minimal Runner Extension

### 5.1 No New Commands

保留现有：

```bash
auto_loop.py next
auto_loop.py record --action commit_only ...
```

不增加 `commit-plan`、`commit-step` 或 `progress` result。

### 5.2 Multiple Commit Results

为 `record` 增加可重复参数：

```bash
--repo-commit <repository-root>::<commit-hash>
```

item 增加可选字段：

```json
{
  "commit": "<primary-or-last-commit>",
  "commits": [
    {"repository": "vendor/skill-garden", "commit": "321bcc1..."},
    {"repository": ".", "commit": "b8c611f..."}
  ],
  "attempts": {"commit_repair": 0}
}
```

- `--commit` 和 `item.commit` 原样保留，保证旧调用兼容。
- `--repo-commit` 只接受 run baseline 中已登记的仓库和可解析的本地 commit object；相同仓库/hash 重复回写幂等，不同 hash 冲突时报错。
- 成功和失败 record 都保存 `commits[]`，因此部分成功不会丢失。
- 默认 status 显示仓库数与短 hash；verbose 输出完整列表。

### 5.3 Repairable Commit Failure

沿用 `record --result failed`，新增约定的 failure type：

```text
commit-repairable
```

runner 行为：

1. 保存本次 `--repo-commit` 和失败摘要。
2. `attempts.commit_repair += 1`。
3. 前 3 次失败保持 item 为 running、`current_step=commit_only`，下一次 `next` 重新发出同一个 action。
4. 第 4 次失败后 blocked 为 `commit-repair-budget-exhausted`，保留 commits 和恢复提示。
5. `retry-blocked` 重置该预算，但不删除已完成 commits。

只有 `trellis-push` 已确认现场仍安全、失败来自确定性生成未收敛或可重新规划的本地预检时，才允许使用 `commit-repairable`。计划外 dirty、retained 漂移、未知 staged、分支/HEAD 漂移、归属歧义和外部副作用风险直接 blocked。

## 6. Self-Repair Algorithm

重新收到 `commit_only` 时，`trellis-push` 不依赖旧内存计划，而是从真实 Git 状态重建：

1. 读取 item 已记录的 `commits[]`。
2. 对每个已记录 commit 验证仓库、commit object、message 和文件集合仍符合当前任务证据。
3. 验证通过则把该仓步骤视为完成并跳过；验证失败则安全 blocked，不重复提交。
4. 确定性生成命令可以重新运行；如果输出已经收敛为相同内容，继续后续步骤。
5. 后续 planned 最终 clean 时跳过空 commit。
6. 全部仓库完成后，用主仓/最后 commit 和全部 `--repo-commit` 执行现有成功 record。

该方式以 Git 事实为恢复真源，不需要持久化完整计划、cursor 或每一步结果。

## 7. Compatibility

- 不提升 schema version；`commits` 和 `attempts.commit_repair` 都是可选字段。
- 没有 `--repo-commit` 时行为与现有单仓 commit-only 完全一致。
- 历史 runtime 继续可读，旧 Skill 仍可使用单个 `--commit` 完成。
- task progress 有多个 commit 时列出 `<repository>:<short-hash>`；只有一个时保留原文案。
- `snapshot_commit` 继续保持原语义，不复用为第二仓 commit。

## 8. Distribution

canonical 修改范围：

- `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- 对应 `.claude/skills/` 副本

随后运行 `npm run sync`，同步 `enhancements/0.6` 与当前 dogfood runner/Skills，并执行 compiled target、Patch conflict 和上下文预算检查。

## 9. Trade-Offs

- 不保存完整执行图，极端情况下恢复需要重新分析任务证据和 Git；这是有意选择，以换取较小实现和更少状态漂移。
- 受约束推断比仅接受任务文档更灵活，但安全性依赖 `trellis-push` 每次重新验证 exact paths 和命令副作用边界。
- 三轮自动修复与现有 fix/recheck 预算保持一致，覆盖常见生成未收敛和部分提交恢复；第 4 次失败转人工，避免无人值守无限循环。
