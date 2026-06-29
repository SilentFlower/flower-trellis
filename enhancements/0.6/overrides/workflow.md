### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: Phase 1.4 task brief handoff, Phase 2.1 implement routing, Phase 2.2 check/check-all routing, current-task route reuse, post-check stop, auto-loop commit-only preauthorization, Phase 3.4 trellis-push, explicit Phase 3.5 finish-work bookkeeping, and push-progress recovery. State blocks should keep one short skill-garden sentinel; long-form rules live here.

**Mechanical rule**: use this hub as the source of truth. Do not add separate top-level skill-garden override sections or multiple skill-garden sentinels inside the same `workflow-state:*` block.

#### Task Brief Handoff

Before Phase 1.4 `task.py start`, use `trellis-task-brief` to refresh `<task>/brief.md` from latest task artifacts, display it in chat, and wait for user confirmation.

`brief.md` is derived; `prd.md` / `design.md` / `implement.md` remain authoritative.

Before the first implement route, restate existing `<task>/brief.md` in chat. If missing, read task artifacts and suggest backfilling brief; do not invent one from memory.

#### Routing Gate

Phase 2.1 implement and Phase 2.2 check/check-all require route evidence before execution.

At each route boundary:

1. Reuse only an explicit, target-matched `route_decision` already present in the current context.
2. Otherwise you MUST load/read/use `trellis-route(target=implement|check)` before deciding. `trellis-route` owns session runtime recovery, `.route-prefs.tmp`, fallback choices, runtime-state writes, and dispatch mapping.
3. If the platform cannot invoke skills directly, open the local `trellis-route/SKILL.md` copy first, then follow its numbered fallback choices in normal chat and wait.
4. If the route helper cannot ask through `AskUserQuestion` / `request_user_input`, ask the same numbered choices from `trellis-route` in normal chat and wait.

Plain user preference, ordinary compact/SessionStart summary, `codex-mode`, empty/old prefs, and raw `.trellis/.runtime/sessions/*` `route_decisions` content that has not been validated by `trellis-route` are not route evidence by themselves.

User reselect/override/use-X-this-time/clear-default wins over remembered route evidence, runtime state, and personal prefs.

At Phase 2.1/2.2, this gate overrides lower "Active Task Routing" rows that say to dispatch `trellis-implement` / `trellis-check` directly. Do not ask meta continuation questions, and dispatch subagents only when the resolved route selected subagent.

#### Post-Check Stop Gate

After `trellis-check` or `trellis-check-all` finishes, stop and report the result; point the user to Phase 3.4 `trellis-push` (or commit-only when needed). Do not run `/trellis:finish-work`, do not archive the task, and do not imply the task is ready to wrap up solely because checks passed.

If checks pass, the next allowed workflow steps are Phase 3.3 `trellis-update-spec` and Phase 3.4 `trellis-push`/commit confirmation. `/trellis:finish-work` is explicit-only: run it only after Phase 3.4 is complete and the user asks to wrap up, archive, or finish the task.

During a running `trellis-auto-loop`, the runner's `record` + `next` replaces the post-check stop gate: after a check pass, record the result, then continue to spec update / commit-only according to `.trellis/scripts/auto_loop.py`. Outside auto-loop, keep the normal stop gate.

#### Code Commit Confirmation Gate

Code commit/push belongs only to Phase 3.4 and must go through `trellis-push`; the main session must not run bare `git commit` / `git push` for code.

`trellis-push` confirmation must show both the exact file list to stage and the drafted commit message. Before the user approves that concrete list + message, do not `git add`, commit, or push; never use `git add -A` / `git add .`.

For "commit now, push later", use `trellis-push` commit-only mode; the later push still goes through `trellis-push`. `session_auto_commit` never authorizes code commits; it only affects bookkeeping commits below.

#### Auto-loop Commit-only Preauthorization

When the user explicitly starts `trellis-auto-loop` with `profile=commit-only`, that start preauthorizes only task-related local commits inside that run. When `.trellis/scripts/auto_loop.py status` reports `run_status=running`, `profile=commit-only`, and `outstanding_action.action=commit_only` for the active task, `trellis-push` may execute commit-only without an additional chat confirmation if the plan contains only files attributable to the current task, performs no push/merge/release/archive, and records the commit hash back to the runner.

This exception does not apply to ordinary `trellis-push`. If the plan contains unrecognized staged files, conflicts, dirty files that cannot be attributed safely, push/merge/release/archive intent, external systems, credentials, or production data effects, stop or mark the current auto-loop task blocked.

#### Bookkeeping Auto-commit Scope

`session_auto_commit` only governs the bookkeeping commits `task.py archive` / `add_session.py` make for their own `.trellis/tasks/**` and `.trellis/workspace/**` files — never code (gated above). When `false`, those archive/journal writes stay disk-only (no compensating `git commit`).

#### Push Progress Recovery / Snapshot

`trellis-push` may write `last_push_snapshot` into an active task's `task.json` with this schema: `snapshot_at`, `branch`, `pushed_commits`, `completed_steps`, `partial_step`, `next_step`, and `notes`.

When there is no active task, scan `.trellis/tasks/*/task.json` for `status="in_progress"` entries that carry `last_push_snapshot`. If any exist and this session has not already relayed recovery, surface the paused state to the user and suggest rebinding the active-task pointer before resuming.

When an active in-progress task carries `last_push_snapshot`, briefly relay `partial_step` and `next_step` before starting new work. Skip the reminder if it was already relayed in this session or the field is absent.

<!-- END skill-garden overrides v0.6 -->
