#### 2.2 Quality check `[required · repeatable]`

Run `trellis-route(target=check)`, then execute the unified `trellis-check-all` entry using the validated inline/subagent route.

Before interactive Check-All begins, run `python3 ./.trellis/scripts/pre_check_state.py clear`. A missing, task-mismatched, or already-cleared preference is a no-op; a damaged runtime is reported diagnostically but safely defaults to checking.

Check-All selects light/full depth from intent, actual diff, risk, and runtime context. It is audit-only and collect-all by default: report all findings and stop before code changes until the user confirms the repair scope, unless a validated auto-loop owns the continuation.

The existing `Interactive Post-Check Stop Gate` owns one narrow direct Git exception. Only when the latest user message that triggered this completion chain explicitly requested an ordinary push or user-initiated `commit-only`, and Check-All strictly passes with zero findings, no blocker, no partial verification, and no material residual risk requiring user acceptance, show the existing standard report and continue in the same turn to Phase 3.3 `trellis-update-spec`. Any finding, blocker, partial verification, or material residual risk reports and stops. Ordinary interactive checks still report and stop; Check-All never creates the Git plan itself.

After authorized repairs, return through the same route and re-run Check-All. The final pre-commit pass must cover the whole task and cannot be downgraded to light.
