# 简化 Trellis 提交、进度与收尾流程设计

## Architecture

核心原则是让每个入口只理解自己的状态：

```text
Phase 3.4 workflow
  -> trellis-push
       -> 生成最小计划并确认一次
       -> 各业务仓 exact commit/push
       -> task_progress 写入最小进度
       -> 父仓 progress commit/push

auto_loop.py
  -> trellis-auto-loop 校验 runner 状态与预授权
  -> trellis-push internal commit-only 执行 exact commit
  -> trellis-auto-loop record 结果

finish-work
  -> 记录 Git upstream 基线
  -> trellis-release audit-current
  -> exact archive commit
  -> exact journal commit
  -> 按开始时 Git 基线决定是否 push
```

`trellis-push` 不再理解 merge、finish-work、release 证据规则、auto-loop queue 或旧 snapshot 恢复协议。

## Trellis-push Contract

workflow hub 只引用本契约的所有权：详细计划/结果格式完全由 `trellis-push` 管。hub 仅保留 Phase 3.4 唯一入口、exact scope + message、普通模式一次确认、无关 dirty 保留和 unknown ahead 风险，不复制下面的模板细节。

### Modes

| 模式 | 确认 | Git 行为 | 远端任务进度 |
| --- | --- | --- | --- |
| 普通 | 展示最小计划后确认一次 | exact commit + push | 立即独立 commit/push |
| 用户显式 commit-only | 展示最小计划后确认一次 | exact local commit | 不同步 |
| auto-loop internal commit-only | auto-loop run 已预授权 | exact local commit | 不同步，由 runner 记录 |

### Minimal Plan

```markdown
## Trellis Push 计划

[PUSH] 2 个仓库 · 2 个 commit · 12 个文件 · 保留未提交 3 · 风险 0
顺序：skill-garden -> flower-trellis -> task progress

### 1. skill-garden

`fix(trellis): ...`
分支：`beta` -> `origin/beta`
变更：5 个文件 · `+80 -120`
计划提交：<exact files>
Push：执行

### 2. flower-trellis

`fix(flower): ...`
分支：`beta` -> `origin/beta`
变更：7 个文件 · `+120 -40`
计划提交：<exact files>
Push：执行

### 保留未提交的变更（dirty）
- [untracked] <path>
- [unstaged] <path>
- [staged] <path>

任务进度：completed=... | partial=... | next=...
执行：commit -> push -> progress commit -> progress push
确认执行请回复 `确认`。
```

计划不展示 Spec review、check 结果、snapshot JSON、bookkeeping 命令、merge 或 finish-work 信息。planned files 不超过 8 个时完整显示，超过时按目录归组并允许展开同一 exact set；保留 dirty/risk 始终逐项显示。

`retained` 只作为内部集合名，等于“本次排除并保持原状的 dirty paths”；用户输出不单独使用裸 `retained`。unknown ahead、branch/upstream 异常和归属不确定等真正风险使用独立“风险”区。

仓库显示名优先使用 config package 名，没有配置时取 Git top-level 目录名。内部定位别名 `root` / `parent` / `main repo` 不进入输出；例如本项目父仓显示 `flower-trellis`。

### Result

结果复用原有总览和分仓顺序，但删除旧 merge/snapshot/bookkeeping 内容：

```markdown
## Trellis Push 结果

[完成 / 部分完成 / 失败] 2 个仓库 · 2 个业务 commit

### 1. skill-garden
`abc1234 fix(trellis): ...`
分支：`beta` -> `origin/beta`
状态：✓ 已推送

### 2. flower-trellis
`def5678 fix(flower): ...`
分支：`beta` -> `origin/beta`
状态：✓ 已推送

### 任务进度
状态：✓ 已同步 · `fedcba9`
进度：completed=... | partial=... | next=...

### 保留未提交的变更（dirty）
- [untracked] <path>
```

### Exact Commit

```text
git add -- <planned files>
git commit --only -m <message> -- <planned files>
```

普通确认模式允许计划外 untracked/unstaged/staged 文件存在，并验证提交前后的 retained staged set 不变。auto-loop internal commit-only 继续要求 staged 区为空，因为它没有本轮交互确认。

计划漂移只关注 planned files、branch、upstream、conflict/rebase/merge state 和 push 目标。retained files 自身变化只更新结果摘要。

### Multi-repository Execution

- 各仓库独立生成 message 和 exact files，按确认顺序执行。
- 普通模式只确认一次，不再跨仓 merge。
- 每个仓库 push 前列出已有 `@{u}..HEAD`。未知历史 ahead commits 无法按文件排除，必须在计划中解决后才能普通 push。
- 全部仓库成功后同步完整任务进度；部分成功/失败时同步 partial progress，避免恢复时重复已完成仓库。

## Task Progress Contract

### Schema

任务进度写入当前任务 `task.json`：

```json
{
  "progress": {
    "updatedAt": "<ISO-8601>",
    "completedSteps": ["<step>"],
    "partialStep": "<step or null>",
    "nextStep": "<step>",
    "notes": "<summary>"
  }
}
```

进度不记录 `pushMode`、业务 commit hash、仓库 branch 或完整 Git 计划。Git 历史已经提供 commit 证据，任务进度只回答“完成到哪里、当前卡在哪里、下一步是什么”。

### Helper

新增 `task_progress.py` 作为唯一读写入口：

```text
task_progress.py status [--task <task>] --json
task_progress.py write --task <task> --progress-json <json>
```

- `write` 只允许更新 `progress` 字段，不覆盖其他 task 数据。
- `status` 优先读取 `progress`；如果只有 legacy `last_push_snapshot`，映射 completed_steps/partial_step/next_step/notes 返回兼容结果。
- 下一次成功 `write` 删除 legacy `last_push_snapshot`，完成惰性迁移。
- SessionStart / workflow recovery 只展示 partialStep、nextStep、notes，不恢复旧 push mode 或 commit 编排。

### Remote Sync

普通业务 push 结束或部分结束后：

1. 生成最终 semantic progress。
2. 调用 `task_progress.py write`。
3. 只提交当前 `<task>/task.json`：

   ```text
   git add -- <task-json>
   git commit --only -m "chore(task): update <task-name> progress" -- <task-json>
   git push origin <current-branch>
   ```

4. 不进行第二次确认。

进度同步失败不回滚业务 Git 动作。结果必须把业务状态和 progress sync 状态分开报告。

## Auto-loop Boundary

runner 继续产生 `commit_only` action，但只负责状态机：

```text
next -> commit_only
  -> trellis-auto-loop 验证 profile/task/outstanding action
  -> AI 生成 exact files/message
  -> trellis-push internal commit-only
  -> trellis-auto-loop record --commit ... --files ... --commit-message ...
  -> next
```

`trellis-push` 不读取 `.trellis/.runtime/auto-loop/**`，不调用 `auto_loop.py status/record`，不解释 blocked/skipped/queue。runner schema 和 `run_check_all -> run_spec_update -> commit_only` 顺序保持不变。

## Finish-work Boundary

### Release Audit

`trellis-release` 增加 `audit-current` 内部模式：

- 输入固定为当前活动任务。
- 输出固定为 `no-op`、`written` 或 `needs-review`，并附 task/release path 与摘要。
- 高置信有上线事项时写/更新 `<task>/release.md`；高置信无事项时 no-op；不确定时写 `Needs human review`。
- 不生成 `.trellis/releases/` 批次文件，不执行上线，不要求确认。

普通 `trellis-release` 的批次汇总与写盘确认保持不变。

### Exact Archive And Journal

finish-work 在任何移动前记录：task source、children、branch、upstream、`@{u}..HEAD`。

```text
trellis-release audit-current
task.py archive <task> --no-commit
  -> exact source + returned archive/YYYY-MM/<task> + changed child task.json
  -> commit --only
add_session.py ... --no-commit
  -> exact changed journal/index files
  -> commit --only
```

禁止暂存 archive、tasks、workspace 或 `.trellis` 根目录。计划外 dirty/staged 文件保留原状。

### Finish Auto-push

- 开始时 `HEAD == upstream`：说明普通 push 已完成，bookkeeping commits 生成后自动 push。
- 开始时已有 ahead commits：完成本地 bookkeeping commits，但不 push，保护显式 commit-only 和其他本地提交。
- 无 upstream：只保留本地 commits。
- `session_auto_commit=false`：只落盘并报告 exact dirty paths，不 commit/push。

finish-work 不读取 `progress` 或 legacy `last_push_snapshot.push_mode`。

## Failure Semantics

| 场景 | 行为 |
| --- | --- |
| 普通业务 commit 失败 | 停止当前仓；未发生成功动作时不记录虚假 completed progress |
| 前一仓 push 成功、后一仓失败 | 写并推 partial progress，记录已完成/失败/next |
| progress commit/push 失败 | 保留业务结果，单独报告 progress sync 失败 |
| auto-loop 文件归属不安全 | trellis-auto-loop record blocked；队列按 runner 规则继续 |
| release audit 不确定 | 写 Needs human review，finish-work 继续 |
| finish-work 开始时 branch ahead | archive/journal 本地 commit，跳过自动 push |
| unrelated dirty/staged 存在 | exact commit 保留其状态，不阻塞 |
| conflict/rebase/detached HEAD | 停止对应 Git 操作并报告 |

## Compatibility And Migration

- 保留 ordinary `commit-only` 自然语言入口。
- 保留 auto-loop profile/action/runtime schema。
- 读取 legacy `last_push_snapshot`，但新写入改为 `progress`，并在写入时删除 legacy 字段。
- workflow/state 中的 “push snapshot recovery” 改名为 “task progress recovery”。
- `push_snapshot.py` 从 flower 分发清单移除，替换为 `task_progress.py`；升级只清理由 flower manifest 记录的旧脚本路径。
- finish-work 不再依赖 `push_mode`，因此 legacy progress 是否迁移不影响归档。

## Source And Sync Boundaries

`overrides/workflow.md` 与 `workflow-states/*.md` 属于 AI-facing control protocol。修改这些文件时保留既有英文正文和稳定术语，只替换本任务涉及的行为契约；不得为了统一文档语言整段翻译。用户可见的字面命令（例如 `展开文件`）可以按产品约定保留原文。

主要源文件：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md`
- `vendor/skill-garden/.trellis/0.6/scripts/task_progress.py`

同步目标：

- `enhancements/0.6/**` 与 `enhancements/MANIFEST.json`
- 当前 `.agents` / `.claude`
- 当前 `.trellis/workflow.md` 与 `.trellis/scripts/task_progress.py`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`

## Rollout And Rollback

- Rollout：先修改 vendor 源，运行 `npm run sync`，同步 dogfood，再执行普通成功、部分失败、commit-only、auto-loop、finish-work 和 legacy progress 迁移场景。
- Rollback：同时恢复旧 push skill、workflow recovery、finish-work override 与 `push_snapshot.py`；不得只回退其中一个层面。
