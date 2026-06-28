### HIGHEST PRIORITY: skill-garden finish-work release operations override

<!-- BEGIN skill-garden skill override trellis-finish-work v0.6 -->

> Source: github.com/SilentFlower/skill-garden. This block is an injected override for the local Trellis finish-work entry; it is not a maintained copy of the upstream `trellis-finish-work` skill.

#### Release Operations Inference Step

Run this step after finish-work Step 2 dirty-path classification succeeds and before finish-work Step 3 archives task(s).

This step is non-blocking. Do not add an extra user confirmation question, and do not block finish-work solely because `release.md` is absent.

This step must be evidence-based. If the conversation was compacted, resumed, or interrupted, do not rely on memory from the earlier context. Re-read the task files and git evidence before deciding whether release operations exist.

For the active task, read the available task files: `task.json`, `prd.md`, `design.md`, `implement.md`, `implement.jsonl`, `check.jsonl`, and any existing `release.md`. Also use recent work commits, `git log --oneline --name-only`, `git show --name-only <hash>` when a work commit is known, `git diff --name-only`, and the dirty-path classification already gathered during finish-work preflight.

If `<task>/release.md` already exists, compare it with the task requirements, implementation plan, check context, changed files, and commit evidence. Preserve it when it is still accurate. Update it only when the current task context shows an obvious missing release operation or obvious document drift. If drift is plausible but not certain, keep the risk visible and mark the conclusion as `Needs human review`.

If no `release.md` exists:

- High-confidence release work exists: write `<task>/release.md`.
- High-confidence no release work exists after re-reading task files and git evidence: do not create `release.md`; mention in the final finish-work report that no release operations were identified.
- Signals are uncertain but release risk exists: write `<task>/release.md` and mark the conclusion as `Needs human review`.

Release-operation signals include SQL or migrations; configuration, environment variables, feature flags, permissions, secrets, or external endpoints; deployment scripts, one-off commands, data repair, scheduled task triggers, background job reruns, or other batch operations; and external systems or dependent platforms that must be released or coordinated, such as H0 API relay / gateway platforms, messaging platforms, or third-party admin consoles.

When writing or updating `release.md`, use this structure:

```markdown
# Release Operations

## Conclusion
Release operations exist. / No release operations identified. / Needs human review.

## Evidence Checked
- task.json
- prd.md
- design.md / implement.md / implement.jsonl / check.jsonl
- release.md
- git commits / changed files

## Drift Check
Existing release.md is accurate. / Missing release.md. / Drift suspected. / Needs human review.

## SQL Changes
None

## Configuration Changes
None

## Batch / Deployment Scripts / Data Repair
None

## External Systems / Dependent Platforms
None

## Release Order
No special order.

## Rollback Notes
Rollback code only.

## Post-release Verification
Verify according to task acceptance criteria.
```

Classify deployment scripts, one-off commands, data repairs, scheduled task triggers, and job reruns under `Batch / Deployment Scripts / Data Repair`. Classify systems outside the current repository that need coordinated release, such as H0 API relay platforms, under `External Systems / Dependent Platforms`.

Do not write `None`, `No release operations identified`, or `Rollback code only` out of habit. Use those defaults only after checking the task files and git evidence. If the task changed deployment scripts, configuration, SQL, external platforms, permissions, scheduled jobs, or data, record the concrete item and source.

If multiple tasks will be archived in the same finish-work run, process the active task at minimum. Process extra archived tasks only when Step 1 provides enough local context to infer safely; do not add per-task confirmation prompts.

<!-- END skill-garden skill override trellis-finish-work v0.6 -->
