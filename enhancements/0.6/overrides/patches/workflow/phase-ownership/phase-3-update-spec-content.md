#### 3.3 Spec update `[required · once]`

Load `trellis-update-spec` and let it decide whether the task produced executable knowledge that must be recorded.

- `no-op`: continue without creating a spec change.
- `written`: include the necessary spec changes in the task's work batch.
- `needs-review`: stop for the single focused decision returned by the skill.

Do not ask a separate generic “update spec?” question before invoking the skill.

For untracked work, evaluate the actual diff and relevant specs without inventing task artifacts. Keep the cursor at `spec` for `needs-review`; advance it to `push` only for `no-op` or `written`.
