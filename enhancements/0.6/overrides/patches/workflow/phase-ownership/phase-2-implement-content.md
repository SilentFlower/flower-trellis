#### 2.1 Implement `[required · repeatable]`

Implementation requires either an active `in_progress` task with reviewed planning artifacts, or a valid current-session untracked work item. Run `trellis-route(target=implement)` before editing or dispatching.

Follow the validated route result:

- `inline`: load `trellis-before-dev`, read the active task artifacts and referenced context, then implement and run focused verification.
- `subagent`: dispatch the selected implement agent with `Active task: <task path>` as the first prompt line; the agent implements directly and must not recursively dispatch implement/check agents.

For untracked work, route reads only the personal pref helper and never creates task-scoped route decisions. Inline loads relevant project specs from `spec_router.py`; subagent dispatch starts with `Untracked work: <work-id>` and includes the work summary, current stage, actual diff/spec context, and this turn's responsibility instead of task artifacts. If implementation resumes from a downstream stage, set the cursor to `implement` before editing.

Route preference recovery, fallback choices, and runtime evidence belong to `trellis-route`; do not reproduce them here.

When the implementation scope contains a Maven reactor, load `trellis-maven-verify` before composing validation commands. Iteration may use its `quick` source-stale plan with necessary upstreams; handoff requires a successful `final` plan/evidence that covers confirmed changed modules, upstreams, consumers, tests, and artifacts, or an explicit blocked/partial explanation. Final defaults to conservative compilation; use source-stale final only when task/spec/user evidence confirms an internal low-risk change with no public API/DTO/constant, annotation processor, POM, resource-contract, or cross-module protocol impact. Do not broaden to `clean`, `package`, `install`, `deploy`, or full-reactor Maven by habit. Decide whether to pass `--threads` from the current reactor shape, plugin thread safety, shared test resources, and machine capacity; do not run extra Maven builds merely to compare thread counts. Report the evidence path, lifecycle level, compile strategy, covered modules, skipped bindings, and residual risk instead of only saying "compile passed".

After implementation and focused verification, resolve the next action in this order:

For untracked work, focused validation remains owned by the implementation path. When it is complete, advance the cursor to `check`; a failed or partial validation stays at `implement`.

1. A validated auto-loop outstanding action wins; continue to its requested Check-All action without consulting interactive hold state.
2. If the latest user message explicitly requests checking, continuation, commit, or deployment, run `python3 ./.trellis/scripts/pre_check_state.py clear` and enter Phase 2.2 in the same turn.
3. If the latest message explicitly says to defer checking, run `python3 ./.trellis/scripts/pre_check_state.py hold --source user-explicit` and stop before Phase 2.2.
4. After Check-All has run at least once, whether it passed cleanly or reported findings, the first follow-up product/UI/interaction/business edit runs `hold --source follow-up-edit` before editing. This preserves the pause through compaction or resume without counting edit rounds.
5. If `python3 ./.trellis/scripts/pre_check_state.py status` returns a matching hold, finish only focused verification and stop before Phase 2.2. End with this exact short declarative reminder: `你可以继续提修改；准备检查时，使用 check-all，也可以直接说“下一步”或“可以检查了”。`; do not ask a binary question or use closure jargon.
6. Otherwise this is the default first implementation path: immediately enter `trellis-route(target=check)`. Do not end the turn by presenting Check-All as an optional next step.

Planning documents may remain temporarily behind during repeated feedback. The eventual Check-All still audits task-document drift. Check-All findings and their authorized repair/recheck loop never re-enter this Pre-Check gate.
