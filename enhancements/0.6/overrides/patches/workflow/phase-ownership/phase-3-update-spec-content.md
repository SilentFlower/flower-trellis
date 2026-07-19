#### 3.3 Spec update `[required · once]`

Load `trellis-update-spec` and let it decide whether the task produced executable knowledge that must be recorded.

- `no-op`: continue without creating a spec change.
- `written`: include the necessary spec changes in the task's work batch.
- `needs-review`: stop for the single focused decision returned by the skill.

Do not ask a separate generic “update spec?” question before invoking the skill.
