### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: Phase 1.4 task brief handoff, Phase 2.1 implement routing, Phase 2.2 check/check-all routing, current-task route reuse, post-check stop, Phase 3.4 trellis-push, explicit Phase 3.5 finish-work bookkeeping, and push-progress recovery. State blocks should keep one short skill-garden sentinel; long-form rules live here.

**Mechanical rule**: use this hub as the source of truth. Do not add separate top-level skill-garden override sections or multiple skill-garden sentinels inside the same `workflow-state:*` block.

#### Task Brief Handoff

Before Phase 1.4 `task.py start`, use `trellis-task-brief` to refresh `<task>/brief.md` from latest task artifacts, display it in chat, and wait for user confirmation.

`brief.md` is derived; `prd.md` / `design.md` / `implement.md` remain authoritative.

Before the first implement route, restate existing `<task>/brief.md` in chat. If missing, read task artifacts and suggest backfilling brief; do not invent one from memory.

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

`trellis-route` returns 2 normal modes for `target=implement` (inline/subagent) and 2 normal modes for `target=check` (check-all inline/check-all subagent).
Dispatch `trellis-implement`, `trellis-check`, or `trellis-check-all` only when the valid route decision selected subagent. If the valid route decision selected inline, execute inline in the main session.

Before invoking the skill, never:
- write pre-questions ("ready to start? / shall I proceed?")
- state "I lean towards X" or preview the inline/subagent options
- surface route options ahead of time

At Phase 2.1/2.2 boundaries, do not ask meta continuation questions. Either reuse the valid current-task route decision for the target, or obtain a new valid decision through `trellis-route` / numbered fallback.

#### Post-Check Stop Gate

After `trellis-check` or `trellis-check-all` finishes, stop and report the result; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work`, do not archive the task, and do not imply the task is ready to wrap up solely because checks passed.

If checks pass, the next allowed workflow steps are Phase 3.3 `trellis-update-spec` and Phase 3.4 `trellis-push`/commit confirmation. `/trellis:finish-work` is explicit-only: run it only after Phase 3.4 is complete and the user asks to wrap up, archive, or finish the task.

#### Code Commit Confirmation Gate

Code commit/push belongs only to Phase 3.4 and must go through `trellis-push`; the main session must not run bare `git commit` / `git push` for code.

`trellis-push` confirmation must show both the exact file list to stage and the drafted commit message. Before the user approves that concrete list + message, do not `git add`, commit, or push; never use `git add -A` / `git add .`.

For "commit now, push later", use `trellis-push` commit-only mode; the later push still goes through `trellis-push`. `session_auto_commit` never authorizes code commits; it only affects bookkeeping commits below.

#### Bookkeeping Auto-commit Scope

`session_auto_commit` only governs the bookkeeping commits `task.py archive` / `add_session.py` make for their own `.trellis/tasks/**` and `.trellis/workspace/**` files — never code (gated above). When `false`, those archive/journal writes stay disk-only (no compensating `git commit`).

#### Push Progress Recovery / Snapshot

`trellis-push` may write `last_push_snapshot` into an active task's `task.json` with this schema: `snapshot_at`, `branch`, `pushed_commits`, `completed_steps`, `partial_step`, `next_step`, and `notes`.

When there is no active task, scan `.trellis/tasks/*/task.json` for `status="in_progress"` entries that carry `last_push_snapshot`. If any exist and this session has not already relayed recovery, surface the paused state to the user and suggest rebinding the active-task pointer before resuming.

When an active in-progress task carries `last_push_snapshot`, briefly relay `partial_step` and `next_step` before starting new work. Skip the reminder if it was already relayed in this session or the field is absent.

<!-- END skill-garden overrides v0.6 -->
