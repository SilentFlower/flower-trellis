#### 2.2 Quality check `[required · repeatable]`

Run `trellis-route(target=check)`, then execute the unified `trellis-check-all` entry using the validated inline/subagent route.

Check-All selects light/full depth from intent, actual diff, risk, and runtime context. It is audit-only and collect-all by default: report all findings and stop before code changes until the user confirms the repair scope, unless a validated auto-loop owns the continuation.

After authorized repairs, return through the same route and re-run Check-All. The final pre-commit pass must cover the whole task and cannot be downgraded to light.
