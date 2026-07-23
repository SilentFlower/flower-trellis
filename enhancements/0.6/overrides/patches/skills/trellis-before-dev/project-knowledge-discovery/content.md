## Project Knowledge Discovery

Before choosing an approach for non-trivial project work, run:

```bash
python3 ./.trellis/scripts/spec_router.py "<short query describing the intended action>"
```

Build the query from the current request and immediate context: intended action, commands about to run, affected files or systems, package/layer, and relevant domain terms.

Run discovery when project-local SOPs, package conventions, workflow rules, configuration/state contracts, release/deploy/rollback steps, Git history actions, data changes, cross-layer design, generated artifacts, install/sync pipelines, or destructive operations may change the correct approach. Read high-confidence matches before acting; read medium-confidence matches only when their path, heading, index description, or reason clearly fits.

If nothing matches, continue with the package/spec discovery steps below. Skip this command for pure Q&A, simple read-only inspection, opening local tools, or trivial edits unless project conventions may change the approach.
