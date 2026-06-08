### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: Phase 2.1 / 2.2 / 3.1 dispatch routing, Phase 3.4 code-commit/push via trellis-push, Phase 3.5 finish-work bookkeeping, and push-progress recovery / snapshot reminders. State blocks should keep only one short skill-garden sentinel per state; long-form rules live here.

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

#### Code Commit Confirmation Gate

Every code commit — and its push — belongs to Phase 3.4 and MUST go through `trellis-push`, mirroring how implement/check must go through `trellis-route`. From the main session the agent never runs bare `git commit` / `git push` on code to bypass it.

`trellis-push` IS the confirmation mechanism: its Step 2.2 stages only an explicit, user-approved file list (never `git add -A` / `git add .`); its Step 2.3 shows the drafted commit message for approval. "Confirmed" means the user saw that concrete file list + message inside `trellis-push` and approved it. A preference-style choice does NOT count — e.g. an `AskUserQuestion` "split / single commit" option only picks a strategy, and an option label/description never substitutes for the real file-list + message display.

For Phase 3.4 "commit now, push later", invoke `trellis-push` in commit-only mode (commit without pushing); the later push also goes through `trellis-push`.

This gate is independent of `session_auto_commit`: that switch never authorizes a code commit and never waives going through `trellis-push`. The only bare-`git` commits allowed are the two bookkeeping scripts below, which manage their own `.trellis/**` files.

#### Bookkeeping Auto-commit Scope

`session_auto_commit` only governs the bookkeeping commits `task.py archive` / `add_session.py` make for their own `.trellis/tasks/**` and `.trellis/workspace/**` files — never code (gated above). When `false`, those archive/journal writes stay disk-only (no compensating `git commit`).

#### Push Progress Recovery / Snapshot

`trellis-push` may write `last_push_snapshot` into an active task's `task.json` with this schema: `snapshot_at`, `branch`, `pushed_commits`, `completed_steps`, `partial_step`, `next_step`, and `notes`.

When there is no active task, scan `.trellis/tasks/*/task.json` for `status="in_progress"` entries that carry `last_push_snapshot`. If any exist and this session has not already relayed recovery, surface the paused state to the user and suggest rebinding the active-task pointer before resuming.

When an active in-progress task carries `last_push_snapshot`, briefly relay `partial_step` and `next_step` before starting new work. Skip the reminder if it was already relayed in this session or the field is absent.

<!-- END skill-garden overrides v0.6 -->
