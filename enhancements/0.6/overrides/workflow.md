### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: the behaviors covered by the sections below. State blocks should keep one short skill-garden sentinel; long-form rules live here.

**Mechanical rule**: use this hub as the source of truth. Do not add separate top-level skill-garden override sections or multiple skill-garden sentinels inside the same `workflow-state:*` block.

#### Project Knowledge Discovery

Before choosing an approach for non-trivial project work, run project knowledge
discovery when project-local SOPs, package conventions, workflow rules (CI, hooks),
config/state contracts, release/publish/deploy/rollback steps, git history actions,
data changes or fixes (including migrations), cross-layer design, generated artifacts,
install/sync pipelines, or destructive operations may affect the correct approach:

```bash
python3 ./.trellis/scripts/spec_router.py "<short query describing the intended action>"
```

Build the query from the current user request plus relevant immediate context:
the intended action, commands about to run, files or systems involved, package/layer,
and domain words matching the trigger list above.

Read high-confidence matches before acting. For medium-confidence matches, read only
when the path, heading, index description, or reason clearly fits the intended change.
If nothing matches, continue normally.

Do not run discovery for pure Q&A, simple read-only inspection, opening local tools,
or trivial edits unless the request mentions project conventions or local SOPs may
change the approach.

#### Task Brief Handoff

Before Phase 1.4 `task.py start`, use `trellis-task-brief` to refresh `<task>/brief.md` from latest task artifacts, display it in chat, and wait for user confirmation.

`brief.md` is derived; `prd.md` / `design.md` / `implement.md` remain authoritative.

Before the first implement route, restate existing `<task>/brief.md` in chat. If missing, read task artifacts and suggest backfilling brief; do not invent one from memory.

#### Active Task Scope Guard

When a session already has an active task, do not treat unrelated new implementation
requests as permission to implement under that task. If the work is not plainly
covered by the active task title/brief, recommend creating a new Trellis task
and stop before `trellis-route` or file edits. If the user explicitly declines
task tracking, confirm untracked work first and do not use active-task artifacts
or progress for that work. If the user says it belongs to the active task,
update that task's artifacts before implementation.

#### Routing Gate

Phase 2.1 implement and Phase 2.2 check/check-all require route evidence before execution.

At each route boundary:

1. Reuse only an explicit, target-matched `route_decision` already present in the current context.
2. Otherwise you MUST invoke `trellis-route(target=implement|check)` before deciding; if the platform cannot invoke skills directly, read the local `trellis-route/SKILL.md` copy and follow its numbered fallback choices in normal chat and wait. `trellis-route` owns session runtime recovery, `.route-prefs.tmp`, fallback choices, runtime-state writes, and dispatch mapping.
3. If the route helper cannot ask through `AskUserQuestion` / `request_user_input`, ask the same numbered choices from `trellis-route` in normal chat and wait.

Plain user preference, ordinary summaries (compact/SessionStart or otherwise), replacement history, historical bare numeric replies, `codex-mode`, empty/old prefs, and raw `.trellis/.runtime/sessions/*` `route_decisions` content that has not been validated by `trellis-route` are not route evidence by themselves; numbered fallback validity is governed by `trellis-route`.

User reselect/override/use-X-this-time/clear-default wins over remembered route evidence, runtime state, and personal prefs.

At Phase 2.1/2.2, this gate overrides lower "Active Task Routing" rows that say to dispatch `trellis-implement` / `trellis-check` directly. Do not ask meta continuation questions, and dispatch subagents only when the resolved route selected subagent.

#### Post-Check Stop Gate

After `trellis-check` or `trellis-check-all` finishes, stop and report the result. If checks pass, the next allowed workflow steps are Phase 3.3 `trellis-update-spec` and Phase 3.4 `trellis-push`/commit confirmation (commit-only when needed); do not archive the task or imply it is ready to wrap up solely because checks passed. `/trellis:finish-work` is explicit-only: run it only after Phase 3.4 is complete and the user asks to wrap up, archive, or finish the task.

During a running `trellis-auto-loop`, the runner's `record` + `next` replaces the post-check stop gate: after a check pass, record the result, then continue to spec update / commit-only according to `.trellis/scripts/auto_loop.py`. Outside auto-loop, keep the normal stop gate.

#### Code Commit Confirmation Gate

Code commit/push belongs only to Phase 3.4 and must go through `trellis-push`; the main session must not run bare `git commit` / `git push` for code.

`trellis-push` confirmation must show both the exact file list to stage and the drafted commit message. Before the user approves that concrete list + message, do not `git add`, commit, or push; never use `git add -A` / `git add .`.

For "commit now, push later", use `trellis-push` commit-only mode; the later push still goes through `trellis-push`. `session_auto_commit` never authorizes code commits; it only affects bookkeeping commits below.

#### Auto-loop Commit-only Preauthorization

When the user explicitly starts `trellis-auto-loop` with `profile=commit-only`, that start preauthorizes only task-related local commits inside that run. When `.trellis/scripts/auto_loop.py status` reports `run_status=running`, `profile=commit-only`, and `outstanding_action.action=commit_only` for the active task, `trellis-push` may execute commit-only without an additional chat confirmation if the plan contains only files attributable to the current task, performs no push/merge/release/archive, and records the commit hash back to the runner.

This exception does not apply to ordinary `trellis-push`. If the plan contains unrecognized staged files, conflicts, dirty files that cannot be attributed safely, push/merge/release/archive intent, external systems, credentials, or production data effects, stop or mark the current auto-loop task blocked.

#### Bookkeeping Auto-commit Scope

`session_auto_commit` only governs the bookkeeping commits `task.py archive` / `add_session.py` make for their own `.trellis/tasks/**` and `.trellis/workspace/**` files. When `false`, those archive/journal writes stay disk-only (no compensating `git commit`).

#### Push Progress Recovery / Snapshot

Use `python3 ./.trellis/scripts/push_snapshot.py status --json` for recovery reads and `write --task ... --snapshot-json ...` for `trellis-push` writes; do not hand-scan or hand-edit `task.json`.

`trellis-push` still owns snapshot semantics, user confirmation, git operations, and post-run fields; the helper only touches `task.json.last_push_snapshot`.

On recovery, relay the helper's `summary` / `candidates` once and suggest rebinding if there is no active task. Never auto-rebind, infer workflow phase, or hook this into SessionStart / workflow-state injection / `trellis-continue`.

<!-- END skill-garden overrides v0.6 -->
