# Release Operations

## Conclusion
Release operations exist.

## Evidence Checked
- task.json
- prd.md
- design.md / implement.md / implement.jsonl / check.jsonl
- release.md
- git commits / changed files: `961587a`

## Drift Check
Missing release.md. Created during finish-work because this task changes package-published enhancement assets and workflow installation behavior.

## SQL Changes
None

## Configuration Changes
- The installed flower manifest now records `.trellis/scripts/spec_router.py`.
- `enhancements/MANIFEST.json` now records `spec_router.py` in the 0.6 scripts list and points at the updated `vendor/skill-garden` source commit.
- `src/lib/copy-scripts.js` adds `spec_router.py` aliases for targeted `--skills` installation: `spec-router`, `project-knowledge`, `knowledge-router`, and `workflow-enhancement`.

## Batch / Deployment Scripts / Data Repair
- No one-off data repair or scheduled job rerun.
- Before a real package release, run the normal release SOP. In particular, verify `npm run sync` has no new diff and run `node scripts/check-snapshot.mjs` before `npm run release...`.

## External Systems / Dependent Platforms
- `vendor/skill-garden` submodule is pinned to commit `fc6083c`; package consumers receive the corresponding `enhancements/0.6` snapshot from this repository, not the submodule itself.
- Downstream projects need `flower-trellis update --enhance-only` or equivalent update flow before `.trellis/scripts/spec_router.py` and the new workflow prompt appear.

## Release Order
1. Publish / merge the `vendor/skill-garden` commit if this repository's submodule pin must resolve for other checkouts.
2. Keep the flower-trellis parent commit with the updated `enhancements/0.6` snapshot.
3. Follow the normal flower-trellis release SOP for beta or stable release.

## Rollback Notes
- Revert the parent commit `961587a`.
- If needed, revert `vendor/skill-garden` commit `fc6083c` or move the submodule pin back to the previous commit.
- Downstream projects can rerun `flower-trellis update --enhance-only` after rollback to remove the installed script from the managed manifest path.

## Post-release Verification
- Install or update a Trellis 0.6 target and verify `.trellis/scripts/spec_router.py` exists.
- Verify `python3 ./.trellis/scripts/spec_router.py "beta release publish tag changelog"` returns the release SOP.
- Verify `python3 ./.trellis/scripts/spec_router.py "cross layer reuse thinking guide"` returns `.trellis/spec/guides/` candidates.
- Verify `flower-trellis update --enhance-only --skills workflow-enhancement` also installs `.trellis/scripts/spec_router.py`.
