## Autonomous Spec Evaluation

This section replaces the interactive “whether to update” decision. The upstream code-spec depth and seven-section requirements remain authoritative when an update is necessary.

### Result Contract

Every invocation must evaluate the available evidence autonomously and return exactly one result:

```yaml
spec_update_result:
  status: no-op | written | needs-review
  reason: string
  evidence: [string]
  changed_files: [path]
  validation: [string]
```

- `no-op`: no reusable executable contract was learned, the existing specs already cover it, the change is only a one-off implementation/copy/formatting detail, or the user explicitly asked to skip spec updates in the current request.
- `written`: code or test evidence supports a new executable contract, one authoritative target spec is unambiguous, and the minimal write plus focused validation completed successfully.
- `needs-review`: the target spec, business semantics, conflict resolution, or a validation failure cannot be resolved uniquely from repository evidence.

Do not enter the upstream Interactive Mode and do not ask whether a spec should be updated. Only `needs-review` may stop the workflow, and it may ask only one question that is necessary to resolve the current ambiguity.

### Evidence Order

Read real evidence in this order. Do not decide from the chat summary, task title, or intuition alone:

1. For task context, the current task's `implement.jsonl` / `check.jsonl` and every file they reference.
2. For task context, the current task's `prd.md`, `design.md`, and `implement.md`.
3. For untracked context, `untracked_flow.py status --verbose`, including summary, scope, baseline/current fingerprint, focused validation, and Check-All evidence.
4. The final Check-All conclusion and its actual validation evidence.
5. The current subject's actual diff, source code, tests, and commit evidence.
6. Existing specs and their indexes returned by `spec_router.py`.

When there is no active task, use a valid current-session untracked state when present; otherwise require an explicit Update-Spec invocation and use the current request, actual diff, source/tests, and existing specs. Do not invent task evidence.

### Minimal Write Boundary

Capture the current dirty baseline before writing. `written` requires all of the following:

- Every change made by this Update-Spec invocation is under `.trellis/spec/**`. Do not modify business code, tests, workflow, skills, task artifacts, or any other file.
- Modify the smallest required section in the fewest files. Do not opportunistically rewrite, expand, reorganize, or format unrelated content.
- Prefer an existing authoritative spec. Create a new file only when no suitable spec exists, and update the corresponding index in the same invocation.
- Do not write a generic principle merely to avoid `no-op`. New content must provide a concrete executable contract such as signatures, fields, boundaries, error matrices, examples, or test assertions, while following the upstream seven-section requirements.

After writing, reread the spec diff and reverse-check it against source code and tests. At minimum run:

```bash
git diff --check -- .trellis/spec
```

When applicable, also validate indexes/links, code signatures, or project-specific spec checks. Fix uniquely resolvable validation failures inside this skill and rerun validation. Return `needs-review` for failures that cannot be resolved uniquely. If this invocation creates changes outside `.trellis/spec/**`, return `needs-review` with `reason=boundary-violation`, stop immediately, and do not proceed to Push. A completed `written` result does not trigger another manual Check-All.

### Workflow Disposition

- Interactive: after a passed Check-All stop, when the user says “下一步”, “继续”, `next`, `continue`, or an equivalent continuation intent, run this skill. A `no-op` or `written` result must load `trellis-push` in the same turn and present its single confirmation plan. A `needs-review` result stops and must not generate a Push plan.
- Interactive direct Git: when the latest user message that triggered the current completion chain explicitly requests an ordinary push or a user-initiated `commit-only`, use that request only as conditional continuation after a strictly passed Check-All. After the existing standard Check-All report is shown, run this skill in the same turn when no currently valid `spec_update_result` exists. Only `no-op` or `written` may proceed to `trellis-push`; `needs-review` stops. Do not infer this intent from history, summaries, dirty state, or an auto-loop internal `commit-only`.
- Validated auto-loop: for `no-op` or `written`, execute `record --action run_spec_update --result ok` and immediately run `next`. For `needs-review`, execute `record --action run_spec_update --result blocked --failure-type spec-needs-review`; never disguise it as `no-op`.
- Untracked: after the final spec diff stabilizes, run `untracked_flow.py record-spec --result <no-op|written|needs-review> --summary <summary>`. Only `no-op` or `written` may advance to `push`; `needs-review` stays at `spec`. Any later edit outside this skill's allowed `.trellis/spec/**` batch must return through `prepare-edit` and invalidate downstream evidence.

Do not ask again or rerun when a currently valid `no-op` or `written` result already exists. Re-evaluate after the actual diff, Check-All conclusion, or the user's spec intent changes.
