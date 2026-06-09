### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: Phase 2.1 / 2.2 / 3.1 dispatch routing, post-check stop, Phase 3.4 code commit/push via trellis-push, explicit Phase 3.5 finish-work bookkeeping, and push-progress recovery. State blocks should keep only one short skill-garden sentinel per state; long-form rules live here.

**Mechanical rule**: use this hub as the source of truth. Do not add separate top-level skill-garden override sections or multiple skill-garden sentinels inside the same `workflow-state:*` block.

#### Routing Gate

Before any implement/check agent or check skill runs from the main session, the immediately preceding routing decision must come from `trellis-route` or from the same numbered fallback choices shown in normal chat when the helper is unavailable.

`trellis-route` returns 4 modes for `target=check` (check-all/check x inline/subagent) and 2 for `target=implement`. The route prompt is the only place to ask this choice.

If the platform cannot call `AskUserQuestion` / `request_user_input`, ask the same numbered choices in normal chat and wait for the user's reply. Tool unavailability is not permission to record inline/subagent or to dispatch a sub-agent directly.

Before invoking the skill, never:
- write pre-questions ("ready to start? / shall I proceed?")
- state "I lean towards X" or preview the inline/subagent options
- surface Step 1.7 rationale ahead of time

At phase boundaries, do not ask meta continuation questions such as "continue?", "what's next?", or "X or Y?" when the answer determines the next workflow phase. Invoke `trellis-route(implement|check)` first, or ask the same numbered route choices if the helper is unavailable.

Check routing has no 4h preference file. Before `trellis-check`, `trellis-check-all`, or either check sub-agent, route every time so the user can choose check-all vs lightweight and inline vs subagent.

#### Post-Check Stop Gate

After `trellis-check` or `trellis-check-all` finishes, stop and report the result. Do not run `/trellis:finish-work`, do not archive the task, and do not imply the task is ready to wrap up solely because checks passed.

If checks pass, the next allowed workflow steps are Phase 3.3 `trellis-update-spec` and Phase 3.4 `trellis-push`/commit confirmation. `/trellis:finish-work` is explicit-only: run it only after Phase 3.4 is complete and the user asks to wrap up, archive, or finish the task.

#### Code Commit Confirmation Gate

Code commit/push belongs only to Phase 3.4 and must go through `trellis-push`; the main session must not run bare `git commit` / `git push` for code.

`trellis-push` confirmation must show both the exact file list to stage and the drafted commit message. Before the user approves that concrete list + message, do not `git add`, commit, or push; never use `git add -A` / `git add .`.

For "commit now, push later", use `trellis-push` commit-only mode; the later push still goes through `trellis-push`. `session_auto_commit` never authorizes code commits; it only affects bookkeeping commits below.

#### Bookkeeping Auto-commit Scope

`session_auto_commit` only controls auto-commits made by `task.py archive` / `add_session.py` for `.trellis/tasks/**` and `.trellis/workspace/**`; it never authorizes code commits. When `false`, those bookkeeping writes remain uncommitted and must not be manually compensated with a git commit.

#### Push Progress Recovery / Snapshot

`trellis-push` may write `last_push_snapshot` into an active task's `task.json` with this schema: `snapshot_at`, `branch`, `pushed_commits`, `completed_steps`, `partial_step`, `next_step`, and `notes`.

When there is no active task, scan `.trellis/tasks/*/task.json` for `status="in_progress"` entries that carry `last_push_snapshot`. If any exist and this session has not already relayed recovery, surface the paused state to the user and suggest rebinding the active-task pointer before resuming.

When an active in-progress task carries `last_push_snapshot`, briefly relay `partial_step` and `next_step` before starting new work. Skip the reminder if it was already relayed in this session or the field is absent.

<!-- END skill-garden overrides v0.6 -->
