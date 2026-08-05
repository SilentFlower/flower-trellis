#### 2.2 Quality check `[required · repeatable]`

Run `trellis-route(target=check)`, then execute the unified `trellis-check-all` entry using the validated inline/subagent route.

For untracked work, route reads only the personal pref helper and the dispatch prompt starts with `Untracked work: <work-id>` plus the work summary, current stage, actual diff, relevant specs, and validation context. Findings or new edits return the cursor to `implement`; a strict pass advances to `spec` only when the existing interactive/direct-Git disposition continues the completion chain.

Before interactive Check-All begins, run `python3 ./.trellis/scripts/pre_check_state.py clear`. A missing, subject-mismatched, or already-cleared preference is a no-op; a damaged runtime is reported diagnostically but safely defaults to checking.

Check-All selects light/full depth from intent, actual diff, risk, and runtime context. It is audit-only and collect-all by default: classify main-path issues as `CHK-*`, fallback-path issues as `FBK-*`, and low-risk task-document drift as `DOC-*`. Assign P0/P1/P2 to both `CHK-*` and `FBK-*` after root-cause classification; severity does not choose the channel or make either channel optional. Report all items and stop before code changes only when `CHK-*` / `FBK-*` repair scope needs confirmation. The only write exception is low-risk `DOC-*` auto-remediation owned by Check-All and shown in the final report, unless a validated auto-loop owns the continuation.

The existing `Interactive Post-Check Stop Gate` owns one narrow direct Git exception. Only when the latest user message that triggered this completion chain explicitly requested an ordinary push or user-initiated `commit-only`, and Check-All strictly passes with zero remaining `CHK-*` and zero remaining `FBK-*` findings, no blocker, no partial verification, and no material residual risk requiring user acceptance, show the existing standard report and continue in the same turn to Phase 3.3 `trellis-update-spec`. Any remaining finding, blocker, partial verification, or material residual risk reports and stops. Ordinary interactive checks still report and stop; Check-All never creates the Git plan itself.

After authorized repairs, return through the same route and re-run Check-All. The final pre-commit pass must cover the whole task and cannot be downgraded to light.
