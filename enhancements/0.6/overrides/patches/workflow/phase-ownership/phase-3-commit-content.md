#### 3.4 Commit changes `[required · once]`

Load `trellis-push`. It owns dirty-file classification, exact file/message planning, one-shot confirmation, Git safety checks, ordinary commit + push, and current-task progress synchronization.

For untracked work, the current state baseline/scope/evidence owns attribution and there is no task progress commit. After every confirmed repository action succeeds and the final workspace evidence is recorded, clear the untracked state with `--reason completed`; partial or failed Git execution keeps the state for recovery.

Ordinary mode defaults to commit and push. Commit-only is allowed only when the user explicitly requests a local commit or a validated auto-loop supplies its scoped preauthorization.

Do not run bare `git add`, `git commit`, or `git push` as a substitute for this phase.
