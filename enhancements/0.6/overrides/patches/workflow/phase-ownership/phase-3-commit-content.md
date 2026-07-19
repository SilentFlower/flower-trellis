#### 3.4 Commit changes `[required · once]`

Load `trellis-push`. It owns dirty-file classification, exact file/message planning, one-shot confirmation, Git safety checks, ordinary commit + push, and current-task progress synchronization.

Ordinary mode defaults to commit and push. Commit-only is allowed only when the user explicitly requests a local commit or a validated auto-loop supplies its scoped preauthorization.

Do not run bare `git add`, `git commit`, or `git push` as a substitute for this phase.
