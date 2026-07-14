### HIGHEST PRIORITY: skill-garden overrides

<!-- BEGIN skill-garden overrides v0.6 -->

> Central high-priority override hub for Trellis 0.6 workflow behavior. Source: github.com/SilentFlower/skill-garden.

**Priority**: This hub overrides any conflicting Trellis workflow, skill, or command text for the scoped behaviors below.

**Scope**: the behaviors covered by the sections below. State blocks should keep one short skill-garden sentinel; long-form rules live here.

**Mechanical rule**: use this hub as the source of truth. Do not add separate top-level skill-garden override sections or multiple skill-garden sentinels inside the same `workflow-state:*` block.

#### Brainstorm Gate

`trellis-brainstorm` is the required Phase 1.1 gate for new, complex, or unclear work.

`task.py create` only creates the planning workspace. A default `prd.md` does not mean requirements are ready.

Before `task.py start`, unclear scope, unresolved decisions, or non-testable acceptance criteria must return to `trellis-brainstorm`.

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

Read high-confidence matches before acting; read medium-confidence matches only when
the path, heading, index description, or reason clearly fits the intended change.
If nothing matches, continue normally. Skip pure Q&A, simple read-only inspection,
opening local tools, or trivial edits unless project conventions or local SOPs may
change the approach.

#### Task Brief Handoff

Before Phase 1.4 `task.py start`, use `trellis-task-brief` to refresh `<task>/brief.md` from latest task artifacts, display it in chat, and wait for user confirmation.

`brief.md` is derived; `prd.md` / `design.md` / `implement.md` remain authoritative.

Before the first implement route, restate existing `<task>/brief.md` in chat. If missing, read task artifacts and suggest backfilling brief; do not invent one from memory.

#### Flower Update Confirmation

If `<flower-update>` has `priority: blocking_confirmation_required`, handle it first: briefly show `release_notes` when present, show `recommended_command`, and ask before running it.

If `<flower-update-result>` requests `run_trellis_push_confirmation`, enter `trellis-push` planning with update changes as default candidates; still require file-list and commit-message confirmation.

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

Plain preferences, summaries (including compact/SessionStart), replacement history, historical bare numeric replies, `codex-mode`, empty/stale prefs, and raw runtime files are not route evidence unless validated by `trellis-route`; numbered fallback validity is governed by `trellis-route`.

User reselect/override/use-X-this-time/clear-default wins over remembered route evidence, runtime state, and personal prefs.

At Phase 2.1/2.2, this gate overrides lower "Active Task Routing" rows that say to dispatch `trellis-implement` / `trellis-check` directly. Do not ask meta continuation questions, and dispatch subagents only when the resolved route selected subagent.

#### Post-Check Stop Gate

After `trellis-check` or `trellis-check-all` finishes, stop and report the result. If checks pass, the next allowed workflow steps are Phase 3.3 `trellis-update-spec` and the minimal Phase 3.4 `trellis-push`; do not archive the task or imply it is ready to wrap up solely because checks passed. `/trellis:finish-work` is explicit-only: run it only after Phase 3.4 is complete and the user asks to wrap up, archive, or finish the task.

The ordinary post-check report may contain only check dimensions/results, executed validations, residual risks, the conclusion, and the next-step pointer. It must not draft a commit message, show `Proposed commits` or planned/staged files, choose commit-only, ask the user to reply `ok` to commit, or perform Phase 3.3/3.4 work. Stop after the report and wait for the user to continue.

During a running `trellis-auto-loop`, the runner's `record` + `next` replaces the post-check stop gate: after a check pass, auto-loop records the result, then continues to spec update / internal commit-only according to `.trellis/scripts/auto_loop.py`. Outside auto-loop, keep the normal stop gate.

#### Code Commit Confirmation Gate

Code commit/push belongs only to Phase 3.4 and must go through `trellis-push`; the main session must not run bare `git commit` / `git push` for code.

Entering Phase 3.4 means loading and following `trellis-push`; drafting a commit message or file plan outside that skill is not an equivalent substitute. Ordinary mode defaults to exact commit + push. Commit-only is allowed only when the user explicitly requests a local commit, or when auto-loop invokes the internal executor after its own preauthorization check.

This gate fully supersedes the lower Phase 3.4 walkthrough that drafts `Proposed commits`, runs local commits directly, or says never to push. Under skill-garden, treat that lower walkthrough as inactive; do not mix any of its plan, confirmation, or execution steps with `trellis-push`.

`trellis-push` owns all detailed plan/result presentation; this hub must not duplicate its templates, field order, repository labels, retained-dirty wording, or display thresholds. The hub only requires one ordinary confirmation over the exact file set and commit message. Before approval, do not `git add`, commit, or push; after approval, use exact paths with `git commit --only`, never `git add -A` / `git add .`. Unrelated dirty/staged paths stay retained and do not block the exact commit, while unknown ahead commits remain a branch-level push risk.

For "commit now, push later", use explicit `trellis-push` commit-only mode. `session_auto_commit` never authorizes code commits; it only affects finish-work bookkeeping below.

#### Auto-loop Commit-only Preauthorization

When the user explicitly starts `trellis-auto-loop` with `profile=commit-only`, that start preauthorizes only task-related local commits inside that run. `trellis-auto-loop` owns all status/profile/action/task validation, staged-area safety checks, semantic file attribution, and runner `record` calls.

After validation, auto-loop passes exact files and commit message to `trellis-push` internal commit-only. That internal path only performs the exact local commit: it does not read auto-loop runtime, call `status`/`record`, push, or write remote task progress. On success auto-loop records the commit hash/files/message and immediately asks the runner for `next`.

This exception does not apply to ordinary `trellis-push`. If the plan contains non-empty staged state, conflicts, unattributable files, remote push, release/archive intent, external systems, credentials, or production data effects, auto-loop must write the matching failed/blocked result and leave the files untouched.

#### Bookkeeping Auto-commit Scope

`session_auto_commit` only governs exact finish-work bookkeeping commits produced after `task.py archive --no-commit` and `add_session.py --no-commit`. When `false`, release/archive/journal writes stay disk-only. When `true`, finish-work commits only actual task source/destination/changed child task files and actual journal/index files; unrelated dirty/staged paths are retained.

Finish-work auto-push uses only its start baseline: push bookkeeping when an upstream exists and start `HEAD` exactly matched upstream; if the branch was already ahead, behind/diverged, or had no upstream, keep the new bookkeeping commits local. Task progress and working-tree cleanliness do not decide this behavior.

#### Task Progress Recovery

Use `python3 ./.trellis/scripts/task_progress.py status --json` for recovery reads and `write --task ... --progress-json ...` for progress writes; do not hand-scan or hand-edit task progress.

The helper only touches `task.json.progress`, whose fields are `updatedAt`, `completedSteps`, `partialStep`, `nextStep`, and `notes`. It may read legacy `last_push_snapshot` as a compatibility source; the next successful write creates `progress` and removes the legacy field.

Ordinary `trellis-push` owns the semantic progress summary and the separate exact progress commit/push after business Git actions. Commit-only paths do not create remote progress commits.

On recovery, relay the helper's `summary` / `candidates` once and suggest rebinding if there is no active task. Show only partial step, next step, and notes when useful. Never auto-rebind, infer a workflow phase, or restore old commit/push orchestration.

<!-- END skill-garden overrides v0.6 -->
