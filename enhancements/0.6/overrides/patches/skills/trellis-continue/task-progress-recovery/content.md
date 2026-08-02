## Step 1.5: Recover Saved Task Progress

Before loading the Phase Index or deciding a workflow step, run:

```bash
python3 ./.trellis/scripts/task_progress.py status --json
```

Treat the structured result as advisory recovery evidence only:

- For `status=ok` with `taskStatus=in_progress`, relay only `summary.partialStep`, `summary.nextStep`, and notes that are necessary to resume safely.
- For `status=ok` with `taskStatus=completed`, do not resume Phase 2 or Phase 3.3/3.4. Point only to explicit `trellis-finish-work` archive, unless the user explicitly requests rework.
- For `status=candidates`, relay each healthy candidate with its `taskStatus` plus necessary `invalidCandidates` or `scanWarnings`, and suggest an explicit rebind when appropriate. A completed candidate points to finish-work/archive, not implementation. Never rebind the session or task automatically.
- For `status=no-progress` or `status=no-current-task`, continue without inventing saved progress. For `status=error`, report the structured blocker instead of guessing.

Progress never overrides the task `status`, planning artifacts, or workflow ordering. Do not infer a Phase from progress, restore a previous push mode, or resume Git/commit orchestration from it.

To rework a completed task, first obtain an explicit user decision, then run:

```bash
python3 ./.trellis/scripts/task_progress.py reopen --task <task-name> --json
```

Only `completed -> in_progress` is valid. Reopen clears `completedAt` but preserves the auditable progress record. If the rework changes requirements or planning boundaries, refresh the planning artifacts and Brief and obtain approval again before implementation.

### Planning Resume Gate

When the current task is still `status=planning`, enter `trellis-brainstorm` before using artifact presence to choose Phase 1.3 or 1.4. Existing `prd.md`, `design.md`, `implement.md`, JSONL files, or `brief.md` prove only that files exist; they do not prove that acceptance criteria are testable, key decisions have converged, repository-answerable questions were researched, or remaining questions genuinely require the user.

Only after the `trellis-brainstorm` Quality Bar is satisfied may the flow load `trellis-task-brief`, refresh and display the current full brief, and wait for a current explicit user confirmation before `task.py start`. Earlier implementation intent, auto-loop startup, or confirmation for older artifact contents cannot authorize the resumed start.
