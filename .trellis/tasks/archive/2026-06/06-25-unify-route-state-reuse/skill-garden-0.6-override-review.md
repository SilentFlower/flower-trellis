# skill-garden 0.6 override 对照建议

## 范围

这里只看 `vendor/skill-garden/.trellis/0.6/overrides/**`。`0.5` 按本次讨论不处理。

这里的“原文”是当前工作区里的 0.6 override 文本。“建议文本”不是为了少占 token，而是为了降低误路由概率：把“什么是有效 route 决策”“什么时候复用”“什么时候必须重新 route”“inline state 和 inline route 的区别”写得更机械、更少依赖模型自己推理。

## 总体判断

我认为正向的改动有三类：

1. `workflow.md` 的 `Routing Gate` 值得重写结构，但不删语义。现在内容已经覆盖了关键约束，只是规则分布略散，容易让模型抓住其中一句而忽略优先级。建议改成“有效决策定义 -> 执行顺序 -> 无效来源 -> 复用范围 -> 模式边界 -> 提问禁令”的顺序。
2. `workflow-states/in_progress.md` 和 `workflow-states/in_progress-inline.md` 值得改成更明确的状态哨兵。它们应该是每轮注入时的短硬规则，不应该重新承载完整 hub。尤其 `in_progress-inline` 必须强调“inline state 不是 inline route”。
3. `workflow-states/no_task.md` 可以小幅改。重点是把内置 Plan Mode 的禁令写硬：不要调用 Claude Code / Codex / harness 自带的 plan mode，不要把它当成 Trellis 任务同意、planning、route gate 的替代品。

我不建议动：

- `workflow-states/planning.md`：目前没有和 route 复用冲突的内容，改它收益不高。
- `skills/trellis-finish-work.md`：它虽然长，但属于 release operations 的证据检查流程，和本次 route 复用问题不是同一条线。为了“简洁”改它容易丢掉 release 风险判断。

## 1. `workflow.md` / `Routing Gate`

### 为什么这是正向改动

当前文本已经把问题都说到了，但“合法来源”“prefs 的权限边界”“复用范围”“重新 route 条件”“fallback 提问”散在多个段落里。对这次真实事故来说，风险点是模型把 compact summary 或用户自然语言当成 route 决策。建议文本把 route decision 当作一个合同来写：先定义有效对象，再定义固定执行顺序。

### 原文

```markdown
#### Routing Gate

Before Phase 2.1 implement or Phase 2.2 check/check-all execution, either reuse a current-task route decision with a valid `route_decision.source`, or obtain one from `trellis-route` / the same numbered fallback choices.

Valid route sources are only `trellis-route`, `numbered-fallback`, and `route-prefs` read by `trellis-route`. User prose such as "I choose inline", compact summaries, SessionStart summaries, `codex-mode`, empty `.route-prefs.tmp`, and old single-value prefs are not valid route decisions by themselves.

Phase 2.2 is the normal check execution point. Dispatch `trellis-check` / `trellis-check-all` only when the current task's valid check route decision selected subagent.

When the current task already has a valid implement/check `route_decision`, reuse it for later implementation, check failures, user-reported issues in the just-checked work, repair, recheck, and final re-check. Do not rerun `trellis-route` just because check failed, code was repaired, or a final re-check is needed.

Rerun `trellis-route` only when no valid current-task route decision exists for the target, or when the user explicitly asks to reselect/override/use another mode/clear the default.

`trellis-route` may use the gitignored personal preference file `.trellis/.route-prefs.tmp` to skip repeated prompts. This file is developer-local state and must never be staged or committed.

Personal route preferences are execution-mode preferences only, never authorization to start work; `trellis-route` may read them only after the workflow already permits the requested target.

`trellis-route` returns 2 normal modes for `target=implement` (inline/subagent) and 2 normal modes for `target=check` (check-all inline/check-all subagent). Lightweight `trellis-check` is a hidden escape hatch only when the user explicitly asks for `light check` / `轻量检查`; it is not shown in normal check options.

If `AskUserQuestion` / `request_user_input` is unavailable, ask the same numbered choices in normal chat and wait. Tool unavailability is not permission to choose inline/subagent, dispatch directly, or run inline check by default.

Before invoking the skill, never:
- write pre-questions ("ready to start? / shall I proceed?")
- state "I lean towards X" or preview the inline/subagent options
- surface route options ahead of time

At Phase 2.1/2.2 boundaries, do not ask meta continuation questions. Reuse a valid current-task route decision when present; otherwise invoke `trellis-route(implement|check)` or ask the numbered route choices if the helper is unavailable.

If the user says "temporary override", "reselect", "use X this time", "clear route default", or equivalent, the personal preference file must not take priority. `trellis-route` must show the override options again and let the user choose whether the choice is one-time, saved as the new default, or clears the default.

For normal check routing, default to `trellis-check-all` paths. Do not route to lightweight `trellis-check` unless the user explicitly asks for the hidden light-check escape hatch.
```

### 建议文本

```markdown
#### Routing Gate

A route decision is valid only when it is a current-task decision for the requested target (`implement` or `check`) and its structured `route_decision.source` is one of: `trellis-route`, `numbered-fallback`, or `route-prefs`.

`route-prefs` is valid only when read by `trellis-route` after the workflow has already reached Phase 2.1 or Phase 2.2. The gitignored personal preference file `.trellis/.route-prefs.tmp` is developer-local execution-mode state; it must never be staged or committed, and it is never authorization to start work.

Before Phase 2.1 implement or Phase 2.2 check/check-all execution, use this order:

1. Reuse the valid current-task route decision for the requested target when one exists.
2. If the user explicitly asks to reselect, override, use another mode this time, or clear the default, ignore stored preferences for this decision and rerun `trellis-route` / the numbered fallback.
3. If no valid current-task decision exists for the target, run `trellis-route(target=implement|check)`. If the helper cannot ask through `AskUserQuestion` / `request_user_input`, ask the same numbered choices in normal chat and wait.

These are not valid route decisions by themselves: user prose such as "inline" or "I choose inline"; compact summaries; SessionStart summaries; `codex-mode`; empty `.trellis/.route-prefs.tmp`; old single-value prefs; and any remembered or summarized prior choice that does not carry a valid structured `route_decision`.

When a valid current-task implement/check decision exists, reuse it for later implementation in the same task, check failures, user-reported issues in the just-checked work, repair, recheck, and final re-check. Do not rerun `trellis-route` merely because check failed, code was repaired, or a final re-check is needed.

Phase 2.2 is the normal check execution point. Normal check routing returns only `trellis-check-all` paths: check-all inline or check-all subagent. Lightweight `trellis-check` is a hidden escape hatch only when the user explicitly asks for `light check` / `轻量检查`; it is not shown in normal check options.

`trellis-route` returns 2 normal modes for `target=implement` (inline/subagent) and 2 normal modes for `target=check` (check-all inline/check-all subagent). Dispatch `trellis-implement`, `trellis-check`, or `trellis-check-all` only when the valid route decision selected subagent. If the valid route decision selected inline, execute inline in the main session.

Before invoking `trellis-route`, never:
- write pre-questions ("ready to start? / shall I proceed?")
- state "I lean towards X" or preview the inline/subagent options
- surface route options ahead of time

At Phase 2.1/2.2 boundaries, do not ask meta continuation questions. Either reuse the valid current-task route decision for the target, or obtain a new valid decision through `trellis-route` / numbered fallback.
```

### 这里实际删掉或合并了什么

- 合并了两处“没有有效决策就 route / fallback”的重复描述。
- 把 `route-prefs` 的权限边界提前，避免模型把 prefs 当成“自动开工许可”。
- 把 “temporary override / reselect / clear default” 放进执行顺序，而不是放在后面当补充说明。
- 保留了所有实质约束：无效来源、复用范围、fallback 等待、hidden light check、禁止预问、subagent dispatch 边界。

## 2. `workflow-states/in_progress.md`

### 为什么这是正向改动

这个 state block 每轮都会注入，应该像硬哨兵一样工作。当前版本已经可用，但有两点可以更稳：

- 明确“完整规则在 hub，这里只做状态哨兵”，避免后续有人继续往 state block 里塞长规则。
- 把“先复用有效决策、否则 route”与“不能因为工具不可用就默认 inline”放在同一条约束链里。

### 原文

```markdown
<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
Phase 2.1/2.2: reuse a valid current-task `route_decision`; if absent, run `trellis-route(implement|check)` or numbered fallback before implement/check.
Valid route source = `trellis-route`, `numbered-fallback`, or `route-prefs`; prose, compact summaries, `codex-mode`, and empty prefs are not valid route decisions.
Do not spawn `trellis-implement` or `trellis-check*` unless the valid route decision selected subagent.
If the helper is unavailable, ask numbered route choices and wait; do not default to inline check.
Reroute only on explicit reselect/override/use-X-this-time/clear-default, not merely because of repair, recheck, or final re-check.
After `trellis-check` / `trellis-check-all`, stop and report; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push goes through `trellis-push` (commit-only mode for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress v0.6 -->
```

### 建议文本

```markdown
<!-- BEGIN skill-garden workflow-state in_progress v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress):
This state block is a breadcrumb; the top-level skill-garden hub is the source of truth for route details.
At Phase 2.1/2.2, use the valid current-task `route_decision` for the target when it exists; otherwise run `trellis-route(implement|check)` or ask the numbered fallback choices and wait.
A valid route decision must come from `trellis-route`, `numbered-fallback`, or `route-prefs` read by `trellis-route`; prose, compact/SessionStart summaries, `codex-mode`, empty prefs, and old single-value prefs are not enough.
Reuse the valid current-task route through later implementation, repair, recheck, and final re-check; reroute only on explicit reselect/override/use-X-this-time/clear-default or when no valid target decision exists.
Do not spawn `trellis-implement` or `trellis-check*` unless the valid route decision selected subagent. If the helper is unavailable, do not default to inline; ask the numbered route choices and wait.
After `trellis-check` / `trellis-check-all`, stop and report; next is Phase 3.3/3.4, and code commit/push must go through `trellis-push`.
Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete; this overrides any lower `Flow: ... -> /trellis:finish-work` line.
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress v0.6 -->
```

### 这里实际删掉或合并了什么

- 没有删除 route 语义，只是把“helper 不可用”和“不能默认 inline”合并到 dispatch 边界。
- 把 `SessionStart summaries` 和 `old single-value prefs` 补进 state guard，和 hub 对齐。
- commit-only 细节不建议删成只剩“必须走 `trellis-push`”。state guard 是每轮注入的硬提醒，保留 `commit-only mode for commit-without-push` 更稳；如果要压缩，只能合并措辞，不能去掉这个场景。

## 3. `workflow-states/in_progress-inline.md`

### 为什么这是正向改动

这个文件是最容易误导模型的地方。名字叫 `in_progress-inline`，但现在的新模式下它不能表示“路由已经选 inline”，只能表示当前 workflow-state 允许主会话执行。建议文本直接写出这点：inline state 不是 inline route。

### 原文

```markdown
<!-- BEGIN skill-garden workflow-state in_progress_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress-inline):
Inline mode does not skip or constrain route: reuse a valid current-task `route_decision`; if absent, run `trellis-route(implement|check)` or numbered fallback.
Valid route source = `trellis-route`, `numbered-fallback`, or `route-prefs`; prose, compact summaries, `codex-mode`, and empty prefs are not valid route decisions.
No valid route decision -> ask numbered route choices and wait; inline mode is not permission to default to inline check.
Reroute only on explicit reselect/override/use-X-this-time/clear-default, not merely because of repair, recheck, or final re-check.
After `trellis-check` / `trellis-check-all`, stop and report; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete.
This guard overrides any lower `Flow: ... -> /trellis:finish-work` line in this state block.
At Phase 3.4, code commit/push still goes through `trellis-push` (commit-only for commit-without-push); never bare `git commit`/`git push` on code (hub: Code Commit Confirmation Gate).
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress_inline v0.6 -->
```

### 建议文本

```markdown
<!-- BEGIN skill-garden workflow-state in_progress_inline v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (in_progress-inline):
This state block is a breadcrumb; the top-level skill-garden hub is the source of truth for route details.
Inline workflow-state is not an inline route decision. At Phase 2.1/2.2, reuse a valid current-task `route_decision` for the target when it exists; otherwise run `trellis-route(implement|check)` or ask the numbered fallback choices and wait.
A valid route decision must come from `trellis-route`, `numbered-fallback`, or `route-prefs` read by `trellis-route`; prose, compact/SessionStart summaries, `codex-mode`, empty prefs, and old single-value prefs are not enough.
Reuse the valid current-task route through later implementation, repair, recheck, and final re-check; reroute only on explicit reselect/override/use-X-this-time/clear-default or when no valid target decision exists.
Do not default to inline just because this state is inline or the helper is unavailable. Dispatch subagents only when the valid route decision selected subagent; otherwise execute inline in the main session.
After `trellis-check` / `trellis-check-all`, stop and report; next is Phase 3.3/3.4, and code commit/push must go through `trellis-push`.
Do not run `/trellis:finish-work` unless the user explicitly asks after Phase 3.4 is complete; this overrides any lower `Flow: ... -> /trellis:finish-work` line.
If active task.json has `last_push_snapshot`, relay `partial_step` + `next_step` once before starting new work.
<!-- END skill-garden workflow-state in_progress_inline v0.6 -->
```

### 这里实际删掉或合并了什么

- 保留“inline state 不跳过 route”，但把它改成更强的句子：`Inline workflow-state is not an inline route decision.`
- 增加 `SessionStart summaries` 和 `old single-value prefs`，避免这次问题在 state block 层复发。
- commit-only 细节不建议删成只剩“必须走 `trellis-push`”。state guard 是每轮注入的硬提醒，保留 `commit-only for commit-without-push` 更稳；如果要压缩，只能合并措辞，不能去掉这个场景。

## 4. `workflow-states/no_task.md`

### 为什么这是正向改动

这个改动不是 route 复用的核心，但它能减少另一个常见误判：把 Codex/Claude 的内置 Plan Mode 当成 Trellis planning 或 task consent。这里应该写成硬禁令：不要调用内置 Plan Mode，也不要把它当成 Trellis consent gate 的替代流程。

### 原文

```markdown
<!-- BEGIN skill-garden workflow-state no_task v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (no_task):
Creating/resuming a task is not implementation permission.
After PRD ready and task started, next implementation action = `trellis-route(implement)`.
If no active task exists, scan `.trellis/tasks/*/task.json` once per session for in-progress tasks with `last_push_snapshot`; surface completed_steps + next_step and suggest rebinding the active task before resuming.
Do NOT use the harness built-in plan mode (`EnterPlanMode` / `ExitPlanMode`) as a substitute for this gate. Planning is Trellis-only: classify the turn, ask for task-creation consent, then `trellis-brainstorm` for complex work.
If the turn is a meta edit to Trellis itself (Trellis tracking would be overkill), say so and ask to skip Trellis — never silently swap built-in plan mode in for the consent gate.
<!-- END skill-garden workflow-state no_task v0.6 -->
```

### 建议文本

```markdown
<!-- BEGIN skill-garden workflow-state no_task v0.6 -->
HIGHEST PRIORITY SKILL-GARDEN STATE GUARD (no_task):
Creating or resuming a task is not implementation permission.
After PRD is ready and the task is started, the next implementation action is Phase 2.1 `trellis-route(implement)` unless a valid current-task implement route decision already exists.
If no active task exists, scan `.trellis/tasks/*/task.json` once per session for in-progress tasks with `last_push_snapshot`; surface `completed_steps` + `next_step` and suggest rebinding the active task before resuming.
Do NOT call the harness built-in plan mode (`EnterPlanMode` / `ExitPlanMode`) for Trellis planning. It is not a substitute for Trellis task-creation consent, Trellis planning, or the route gate. For complex work, classify the turn, ask for task-creation consent, then use `trellis-brainstorm`.
If the turn is a meta edit to Trellis itself and Trellis tracking would be overkill, say so and ask to skip Trellis; never silently swap built-in plan mode in for the consent gate.
<!-- END skill-garden workflow-state no_task v0.6 -->
```

### 这里实际删掉或合并了什么

- 没有删掉 consent gate；这里应该保留并加强原意：不要调用 Claude Code / Codex / harness 自带的 plan mode，不要把它替换成 Trellis planning。
- `completed_steps` / `next_step` 加反引号，降低字段名被模型改写的概率。
- “After PRD ready...” 增加 “unless a valid current-task implement route decision already exists”，和当前任务 route 复用语义一致。

## 5. 不建议改的 0.6 文件

### `workflow-states/planning.md`

我建议不改。它不参与这次误路由的关键链路，也没有和 current-task route reuse 明显冲突的规则。为了统一风格去改它，收益不够。

### `skills/trellis-finish-work.md`

我建议不改，至少不放进这次 route 复用任务里。它的长文本主要是在做 release operations 的证据链约束，和 `trellis-route` 的问题不是同一类。如果要优化，应该单独起一个 release/finish-work 文案任务，按“证据来源、判断分支、模板结构、禁止习惯性 None”四段整理，而不是在 route 任务里顺手删。

## 建议实施顺序

1. 先改 `workflow.md` 的 `Routing Gate`，因为它是 hub 和源头。
2. 再同步改 `in_progress.md` / `in_progress-inline.md`，让每轮注入的 state guard 和 hub 一致。
3. 最后视你是否认可，再改 `no_task.md`。它是小幅正向，但不是解决这次事故的必要条件。
4. `planning.md` 和 `trellis-finish-work.md` 本轮不动。
