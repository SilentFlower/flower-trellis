---
name: trellis-worktree
description: "Prepare and diagnose branch-local Trellis usage inside linked Git worktrees. Use when the user mentions worktree, linked worktree, worktree development, missing .trellis in a worktree, or parallel branch development."
---

# Trellis Worktree

Use this skill before normal Trellis routing when the current request is about linked worktrees or parallel branch development.

Each worktree owns the Trellis and platform files checked out by its branch. Never load `.trellis`, `.agents`, `.codex`, `.claude`, or `.flower` from another worktree, and never create whole-directory symlinks between worktrees.

## Workflow

1. Identify the target worktree. Use the explicit path if present; otherwise use the current working directory.
2. Run external diagnosis first:

```bash
flower-trellis worktree status --target <target-worktree> --json
```

3. Route by status:
   - `ready-local`: continue with the user's original Trellis intent in this worktree.
   - `needs-prepare`: run `flower-trellis worktree prepare --target <target-worktree>` with an explicit developer identity when requested.
   - `needs-init`: initialize Trellis in that branch; do not copy another worktree's version.
   - `needs-migration`: run `flower-trellis worktree migrate --target <target-worktree> --dry-run` before the real migration.
   - `blocked` or `error`: stop and report the stable reason and conflict paths.
4. For a new parallel task, create the worktree before planning files exist:

```bash
flower-trellis worktree create --target <path> --branch <branch> --base <ref> \
  --task-title <title> --task-slug <slug>
```

5. Continue task planning in a new AI session whose cwd is the returned handoff directory.

## Safety Rules

- `status` is read-only.
- `prepare` only creates target-local gitignored state and registry metadata.
- `migrate` may replace only schema v1 manifest-managed symlinks, and only with content reconstructed from the target branch itself.
- Do not read the legacy `sourceRoot` as migration content.
- `create` does not attach or move an existing task.
- `remove` requires a clean worktree with no active task, session, or lock; it preserves the branch.
- Do not use force, copy directories between worktrees, or treat setup as approval to start, check, commit, merge, or push.

## Expected Results

- `ready-local`: local real directories are active for this branch.
- `needs-init`: the branch lacks versioned Trellis content.
- `needs-prepare`: local runtime or developer state is missing.
- `needs-migration`: a valid legacy projection was detected.
- `blocked`: user paths, symlink drift, registry drift, dirty state, task state, or locks prevent mutation.
- `error`: Git metadata or an operation failed with a stable reason.
