/**
 * 0.5 / old 变体的 workflow-state 注入文本常量。
 *
 * 这些块在 skill-garden 的 install.sh 里是内嵌 Python 的 `LEGACY_*` 字面量
 * (0.6 变体的 state 文本改为从 overrides/workflow-states/*.md 读取,不走这里)。
 * 此处逐字符移植,**包括每个块结尾的两个换行**(state 替换时直接拼接,依赖此尾部空行)。
 * 改动需与上游 install.sh 保持一致。
 */

export const LEGACY_NO_TASK_BLOCK = `<!-- BEGIN skill-garden workflow-state no-task-gate v0.5 -->
HIGHEST PRIORITY NO-TASK GUARD (skill-garden):
Creating/resuming a task ≠ permission to implement inline.
After PRD ready and task started, next impl action = \`trellis-route(implement)\`.
Don't infer opt-out from "small/urgent/unclear" — opt-out requires an explicit phrase in the current message (see C below).
<!-- END skill-garden workflow-state no-task-gate v0.5 -->

`;

export const LEGACY_PLANNING_BLOCK = `<!-- BEGIN skill-garden workflow-state planning-handoff v0.5 -->
HIGHEST PRIORITY PLANNING GUARD (skill-garden):
Planning is not implementation permission.
Complete prd.md + context first.
After in_progress, next action = \`trellis-route(implement)\`, not direct edits.
<!-- END skill-garden workflow-state planning-handoff v0.5 -->

`;

export const LEGACY_PUSH_PROGRESS_BLOCK = `<!-- BEGIN skill-garden workflow-state push-progress-recovery v0.6 -->
PUSH PROGRESS RECOVERY (skill-garden):
If you haven't already relayed recovery in this session, scan
\`.trellis/tasks/*/task.json\` for entries where status="in_progress" AND a
\`last_push_snapshot\` field is present (schema: snapshot_at / branch /
pushed_commits / completed_steps / partial_step / next_step / notes).
For each match, surface to the user:
  「发现未完成任务 <title>:上次 push 完成到 <completed_steps>,下一步 <next_step>。要继续吗?」
If multiple match, list them with \`snapshot_at\` so the user can pick.
Then suggest \`python3 ./.trellis/scripts/task.py start <task_path>\` to
re-bind the active-task pointer before resuming work.
Skip this hint if (a) you've already relayed recovery this session, or
(b) no in_progress task carries \`last_push_snapshot\`.
<!-- END skill-garden workflow-state push-progress-recovery v0.6 -->

`;

export const LEGACY_IN_PROGRESS_BLOCK = `<!-- BEGIN skill-garden workflow-state trellis-route v0.5 -->
HIGHEST PRIORITY ROUTE GUARD (skill-garden):
This guard is intentionally appended after upstream in_progress breadcrumbs and overrides earlier direct-dispatch defaults in this same <workflow-state>.
At Phase 2.1/2.2/3.1, invoke \`trellis-route(implement|check)\` first, including every check / check-all path.
Codex \`dispatch_mode: sub-agent\` only makes subagent a selectable route outcome; it is not permission to bypass \`trellis-route\`.
Do NOT spawn \`trellis-implement\` / \`trellis-check\` / \`trellis-check-all\` directly from the main session unless \`trellis-route\` just selected a subagent mode.
If \`trellis-route\` selected inline mode, load \`trellis-before-dev\` / \`trellis-check\` / \`trellis-check-all\` as applicable and execute in the main session.
If \`trellis-route\` or its interactive helper is unavailable, present the same numbered route choices in normal chat and wait for the user's selection; do not record an inline/subagent choice yourself.
CHECK RULE: check never uses \`.trellis/.route-prefs.tmp\`; ask every time before \`trellis-check\`, \`trellis-check-all\`, or their subagents.
ANTI-DEFER: at phase boundaries, never ask meta questions ("X or Y?", "continue?", "what's next?") — invoke \`trellis-route(check)\` instead, or ask the numbered route choices if the helper is unavailable.
<!-- END skill-garden workflow-state trellis-route v0.5 -->

`;

export const LEGACY_PUSH_SNAPSHOT_BLOCK = `<!-- BEGIN skill-garden workflow-state in-progress-push-snapshot v0.6 -->
IN-PROGRESS PUSH SNAPSHOT (skill-garden):
The active task's task.json may carry a \`last_push_snapshot\` field (schema:
snapshot_at / branch / pushed_commits / completed_steps / partial_step /
next_step / notes). Before starting new work this turn, read that field; if
present, briefly relay \`partial_step\` + \`next_step\` so the user knows you
recognize the paused state instead of restarting from scratch. Skip if you
have already relayed this snapshot earlier in the session, or if the field
is absent.
<!-- END skill-garden workflow-state in-progress-push-snapshot v0.6 -->

`;
