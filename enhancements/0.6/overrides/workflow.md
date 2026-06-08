### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: Phase 2.1 / 2.2 / 3.1 dispatch routing, Phase 3.5 finish-work bookkeeping, and push-progress recovery / snapshot reminders. State blocks should keep only one short skill-garden sentinel per state; long-form rules live here.

**Mechanical rule**: use this hub as the source of truth. Do not add separate top-level skill-garden override sections or multiple skill-garden sentinels inside the same `workflow-state:*` block.

#### Routing Gate

Before any implement/check agent or check skill runs from the main session, the immediately preceding routing decision must come from `trellis-route` or from the same numbered fallback choices shown in normal chat when the helper is unavailable.

`trellis-route` returns 4 modes for `target=check` (check-all/check x inline/subagent) and 2 for `target=implement`. Step 1.7's recommendation is generated inside the skill and surfaced via Step 2's `AskUserQuestion`; that is the only prompt point.

If the platform cannot call `AskUserQuestion` / `request_user_input`, ask the same numbered choices in normal chat and wait for the user's reply. Tool unavailability is not permission to record inline/subagent or to dispatch a sub-agent directly.

Before invoking the skill, never:
- write pre-questions ("ready to start? / shall I proceed?")
- state "I lean towards X" or preview the inline/subagent options
- surface Step 1.7 rationale ahead of time

At phase boundaries, do not ask meta continuation questions such as "continue?", "what's next?", or "X or Y?" when the answer determines the next workflow phase. Invoke `trellis-route(implement|check)` first, or ask the same numbered route choices if the helper is unavailable.

Check routing has no 4h preference file. Before `trellis-check`, `trellis-check-all`, or either check sub-agent, route every time so the user can choose check-all vs lightweight and inline vs subagent.

#### Finish-work Bookkeeping Guard

`session_auto_commit` only controls script-managed bookkeeping commits for Trellis task archives and workspace journals. It does not disable Phase 3.4 code-work commits that the user explicitly confirms.

If `.trellis/config.yaml` contains `session_auto_commit: false`, finish-work must treat archive and journal writes as disk-only bookkeeping:

- Running `python3 ./.trellis/scripts/task.py archive <task>` may move task files, but must not be described as producing a `chore(task): archive ...` commit.
- Running `python3 ./.trellis/scripts/add_session.py ...` may write workspace journal/index files, but must not be described as producing a `chore: record journal` commit.
- Do not run a compensating `git add` / `git commit` for `.trellis/tasks/**` or `.trellis/workspace/**` just because those scripts skipped auto-commit.
- Report the resulting `.trellis/tasks/**` and `.trellis/workspace/**` dirty paths to the user as bookkeeping changes for manual review.

Phase 3.4 code-work commits are unchanged. If code files from the task are dirty, the agent may still present the normal one-shot commit plan and commit only after the user confirms.

This guard only prevents archive/journal bookkeeping commits from being forced when `session_auto_commit: false`.

#### Push Progress Recovery / Snapshot

`trellis-push` may write `last_push_snapshot` into an active task's `task.json` with this schema: `snapshot_at`, `branch`, `pushed_commits`, `completed_steps`, `partial_step`, `next_step`, and `notes`.

When there is no active task, scan `.trellis/tasks/*/task.json` for `status="in_progress"` entries that carry `last_push_snapshot`. If any exist and this session has not already relayed recovery, surface the paused state to the user and suggest rebinding the active-task pointer before resuming.

When an active in-progress task carries `last_push_snapshot`, briefly relay `partial_step` and `next_step` before starting new work. Skip the reminder if it was already relayed in this session or the field is absent.

<!-- END skill-garden overrides v0.6 -->
