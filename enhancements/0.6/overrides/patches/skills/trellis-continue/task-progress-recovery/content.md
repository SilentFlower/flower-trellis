## Step 1.5: Recover Saved Task Progress

For Steps 1 and 2, reuse task context and the Phase Index already loaded in the current turn when still valid; otherwise load them normally. Saved-progress recovery and all workflow review/confirmation gates remain required.

Before ordinary progress recovery, if `.trellis/scripts/auto_loop.py` exists, query `python3 ./.trellis/scripts/auto_loop.py status`. A validated active run (`preparing`, `awaiting_input`, or `running`) owns continuation when the user has not explicitly switched to unrelated work: enter `trellis-auto-loop` and resume through its runner action, then return without entering the ordinary planning gate below. This also applies after compaction. Missing, stopped, or terminal runs do not grant this exception; invalid or ambiguous runtime must be diagnosed by the auto-loop owner, never treated as authorization. Do not reconstruct a run from progress notes or chat summaries.

Before deciding a workflow step, run:

```bash
python3 ./.trellis/scripts/task_progress.py status --json
```

Treat the structured result as advisory recovery evidence only:

- For `status=ok` with `taskStatus=in_progress`, relay only `summary.partialStep`, `summary.nextStep`, and notes that are necessary to resume safely.
- For `status=ok` with `taskStatus=completed`, do not resume Phase 2 or Phase 3.3. Enter the `trellis-push` completed-task preflight; it is the one-hop owner that either prepares publication recovery, points to explicit `trellis-finish-work`, or blocks on ambiguous evidence.
- For `status=candidates`, relay each healthy candidate with its `taskStatus` plus necessary `invalidCandidates` or `scanWarnings`, and suggest an explicit rebind when appropriate. After explicit rebind, a completed candidate uses the same Push preflight. Never rebind the session or task automatically.
- For `status=no-progress` or `status=no-current-task`, continue without inventing saved progress. For `status=error`, report the structured blocker instead of guessing.

Progress never overrides the task `status`, planning artifacts, workflow ordering, auto-loop runtime, or Git publication evidence. Do not inspect or classify completed Git recovery here. Do not infer a Phase from progress, restore a previous push mode, or resume Git/commit orchestration from progress text.

To rework a completed task, first obtain an explicit user decision, then run:

```bash
python3 ./.trellis/scripts/task_progress.py reopen --task <task-name> --json
```

Only `completed -> in_progress` is valid. Reopen clears `completedAt` but preserves the auditable progress record. If the rework changes requirements or planning boundaries, refresh the planning artifacts and Brief and obtain approval again before implementation.

### Planning Resume Gate

When the current task is still `status=planning`, enter `trellis-brainstorm` before using artifact presence to choose Phase 1.3 or 1.4. Existing `prd.md`, `design.md`, `implement.md`, JSONL files, or `brief.md` prove only that files exist; they do not prove that acceptance criteria are testable, key decisions have converged, repository-answerable questions were researched, or remaining questions genuinely require the user.

For ordinary planning recovery, only after the `trellis-brainstorm` Quality Bar is satisfied may the flow load `trellis-task-brief`, refresh and display the current full brief, and follow its confirmation or explicit preauthorization rules before `task.py start`. Earlier implementation intent or confirmation for older artifact contents cannot authorize the resumed start. A historical auto-loop startup claim without a validated active runner action is not authorization; validated auto-loop recovery already returned to its owner above.
