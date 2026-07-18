# Technical Design

## Overview

本改造保留 Check-All 通过后的现有停止点，但把用户继续后的 Phase 3.3 从“再次询问是否更新”
改为“必经且自动求值的规范判断”。Check-All 只负责质量结论；Update-Spec override 负责
spec 决策与允许路径内写入；Trellis Push 继续拥有唯一提交确认。

```text
Check-All failed
  -> report + repair scope stop

Check-All passed
  -> report + existing post-check stop
  -> user says next / continue
     -> trellis-update-spec evaluate-current in the same turn
        -> no-op  -------> trellis-push plan in the same turn
        -> written ------> self-validation -> trellis-push plan in the same turn
        -> needs-review -> one focused question -> evaluate-current again
```

auto-loop 保留确定性 action：

```text
run_check_all -> run_spec_update
  no-op/written -> record ok -> next -> commit_only
  needs-review  -> record blocked(spec-needs-review)
```

## Source Of Truth And Distribution

真实源：

- `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-update-spec.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/in_progress-inline.md`
- `vendor/skill-garden/.trellis/0.6/.agents/.claude trellis-auto-loop/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/scripts/auto_loop.py` 的 action instruction（不改状态机）
- `vendor/skill-garden/scripts/install.sh`

flower consumer：

- `src/lib/apply-enhancements.js`
- `src/lib/skill-override-inject.js`
- `test/js/apply-enhancements.test.js`

`npm run sync` 生成 `enhancements/0.6`；dogfood update 把 override 注入当前
`.agents/skills/trellis-update-spec/SKILL.md` 与 `.claude` 副本。

## Update-Spec Override Contract

新增 managed block：

```markdown
### HIGHEST PRIORITY: skill-garden autonomous spec evaluation
<!-- BEGIN skill-garden skill override trellis-update-spec v0.6 -->
...
<!-- END skill-garden skill override trellis-update-spec v0.6 -->
```

### Inputs

按顺序读取：

1. 当前任务 `implement.jsonl` / `check.jsonl` 及其真实文件。
2. `prd.md`、`design.md`、`implement.md`。
3. Check-All 最终结论和实际验证证据。
4. 当前任务实际 diff、源码、测试和提交证据。
5. `spec_router.py` 命中的现有 spec 与对应 index。

如果无活动任务但用户显式调用 Update-Spec，使用当前请求和实际 diff；普通 Check-All 的继续链
只在活动任务内且存在本轮 Check-All passed 证据时生效。

### Decision

```yaml
spec_update_result:
  status: no-op | written | needs-review
  reason: string
  evidence: [string]
  changed_files: [path]
  validation: [string]
```

判定顺序：

1. 当前请求最新意图明确跳过 -> no-op/user-explicit-skip。
2. 没有可复用知识或现有 spec 已覆盖 -> no-op。
3. 存在可执行契约、唯一目标 spec 且证据充分 -> written。
4. 目标/语义/冲突不唯一 -> needs-review。

不得为了避免 no-op 而写原则性总结。`written` 应包含具体签名、字段、边界、矩阵和测试点，并复用
上游 skill 的七段式 code-spec 要求。

### Write Boundary And Self-Validation

- 写前记录 dirty baseline；写后新增变更只能位于 `.trellis/spec/**`。
- 超出允许路径立即停止并报告，不能把越界文件纳入结果。
- 目标唯一时更新现有 spec；新增文件时同步 index。
- 只修改承载新契约所需的最小章节和最少文件；不得借机整理、扩写或格式化无关内容。
- 写后复读实际 diff，与代码/测试证据反向核对。
- 必跑 `git diff --check`；按变更运行链接、索引或项目专用 spec 验证。
- 验证失败且修复唯一时自修复；否则 needs-review。

## Workflow Disposition

### Hub

保留当前 `Interactive Post-Check Stop Gate`，另加一个短 resume chain：

- failed/blocked Check-All：报告并停止。
- passed Check-All：报告并按现有边界停止，不调用 Update-Spec。
- 用户随后表达 next/continue：同一轮先调用 Update-Spec。
- no-op/written：同一轮加载 Trellis Push，提交计划仍等待一次确认。
- needs-review：停止处理规范歧义。

Hub 不包含 decision matrix、override 输出模板或 self-validation 命令，也不复制 Check-All 规则。

### State Guards

两个 in-progress state 各保留一句：

```text
After a passed Check-All stops, the user's next/continue resumes through Update-Spec;
continue no-op/written to trellis-push in the same turn, and stop only for needs-review.
```

### Check-All

不修改 Check-All 的 `Interactive Post-Check Stop Gate`。通过报告后仍停止，Check-All 不调用
Update-Spec，也不生成 Push 计划；后续用户继续意图由 workflow hub 接管。

### Phase 3.4 Preamble

Hub 覆盖上游“再次询问是否应该写 spec”的 preamble。用户继续后进入 Push 前若本轮没有可验证的
Update-Spec outcome，自动调用一次；已有 no-op/written 结果时不重复询问。`needs-review` 不得进入
Push。该前置门禁也覆盖用户在 Check-All 通过后直接说 push 的情况。

## Skill Override Installation

`skill-override-inject.js` 已通用扫描 override 文件，但 `apply-enhancements.js` 的精细安装开关当前
只识别 finish-work。扩展为：

```text
trellis-update-spec
update-spec
update-spec-enhancement
```

`skill-override-inject.js` 为新 override 提供相同 aliases；独立 `install.sh` 同步别名判断。
完整安装继续自动注入所有 override。缺失目标计入 missing，不创建入口。

## Compatibility

- 0.6 现有项目通过全装/update 原位注入 managed block。
- 上游 Update-Spec 正文保留；高优先级 block 覆盖 interactive 判断和 disposition，仍复用七段式模板。
- 旧项目没有 Update-Spec 入口时跳过，不失败。
- 0.5/old 不读取该 override。
- auto-loop runner schema 和 action 名不变，无 runtime migration。

## Context Budget

完整规则只存在 override。Hub/state/Check-All 只替换旧句，不追加平行长段。
完成后记录 workflow、hub、states-total、Phase summary 和 SessionStart actual/delta；默认和 strict checker
都必须通过，不提高 ceiling。

## Testing Strategy

- 静态契约：override 三种结果、允许路径、证据顺序、self-validation、现有 Check-All stop gate、
  next/continue resume chain 和 Push 前置门禁。
- JS consumer：全装注入 agents/claude；精细安装三个别名；缺目标跳过；二次运行幂等。
- Python installer：真实 clone/install 后 agents/claude 注入一致，精细安装别名覆盖。
- Auto-loop：instruction 和 skill mapping 对 no-op/written record ok、needs-review blocked。
- Snapshot/dogfood：vendor -> enhancements -> 当前项目一致，重复 update hash 不变。
- Context budget：默认 + strict。

## Rollback

回退 vendor/flower commits 后重新 `npm run sync` 和 dogfood update。目标项目中的 managed override 会被
旧快照注入器移除/恢复到旧内容；workflow gate 同步回退。无需迁移 runtime state。
