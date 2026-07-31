#### 2.1 Implement `[required · repeatable]`

Implementation requires either an active `in_progress` task with reviewed planning artifacts, or a valid current-session untracked work item. Run `trellis-route(target=implement)` before editing or dispatching.

Follow the validated route result:

- `inline`: load `trellis-before-dev`, read the active task artifacts and referenced context, then implement and run focused verification.
- `subagent`: dispatch the selected implement agent with `Active task: <task path>` as the first prompt line; the agent implements directly and must not recursively dispatch implement/check agents.

For untracked work, route reads only the personal pref helper and never creates task-scoped route decisions. Inline loads relevant project specs from `spec_router.py`; subagent dispatch starts with `Untracked work: <work-id>` and includes the helper's complete state summary instead of task artifacts. Run `untracked_flow.py prepare-edit --paths <exact intended paths>` before every write batch.

Route preference recovery, fallback choices, and runtime evidence belong to `trellis-route`; do not reproduce them here.

After implementation and focused verification, resolve the next action in this order:

For untracked work, first record the focused validation through `untracked_flow.py record-validation`; before entering Check-All, advance to `check`. A failed or partial validation remains in `implement` until the owner evidence permits advancement.

1. A validated auto-loop outstanding action wins; continue to its requested Check-All action without consulting interactive hold state.
2. If the latest user message explicitly requests checking, continuation, commit, or deployment, run `python3 ./.trellis/scripts/pre_check_state.py clear` and enter Phase 2.2 in the same turn.
3. If the latest message explicitly says to defer checking, run `python3 ./.trellis/scripts/pre_check_state.py hold --source user-explicit` and stop before Phase 2.2.
4. After Check-All has run at least once, whether it passed cleanly or reported findings, the first follow-up product/UI/interaction/business edit runs `hold --source follow-up-edit` before editing. This preserves the pause through compaction or resume without counting edit rounds.
5. If `python3 ./.trellis/scripts/pre_check_state.py status` returns a matching hold, finish only focused verification and stop before Phase 2.2. End with this exact short declarative reminder: `你可以继续提修改；准备检查时，使用 check-all，也可以直接说“下一步”或“可以检查了”。`; do not ask a binary question or use closure jargon.
6. Otherwise this is the default first implementation path: immediately enter `trellis-route(target=check)`. Do not end the turn by presenting Check-All as an optional next step.

Planning documents may remain temporarily behind during repeated feedback. The eventual Check-All still audits task-document drift. Check-All findings and their authorized repair/recheck loop never re-enter this Pre-Check gate.
