# Release Operations

## Conclusion
Needs human review.

本任务明确存在后续 beta 发布与回读交接。当前归档核对只保留操作单，不执行 release、不创建 tag、不推送 tag，也不确认历史 release 是否已经覆盖全部回读事项。

## Evidence Checked
- task.json
- prd.md
- design.md
- implement.md / implement.jsonl / check.jsonl
- release.md: missing before audit
- git commits / changed files: `c399f86`, `06c05d`, later release commits touching `package.json`

## Drift Check
Missing release.md. Task materials contain explicit Post-Task Release Handoff, so this file preserves the release boundary for archive review.

## SQL Changes
None

## Configuration Changes
None

## Batch / Deployment Scripts / Data Repair
- [08-19-fix-rd-guide-builtin-ref] Follow the project beta release flow: run `npm run sync`, handle snapshot drift if present, run `node scripts/check-snapshot.mjs`, then run `npm run release:dry -- --prerelease beta`.
- [08-19-fix-rd-guide-builtin-ref] Show the dry-run version and CHANGELOG to the owner. Real release requires explicit owner confirmation.
- [08-19-fix-rd-guide-builtin-ref] After confirmation, rerun sync and snapshot checks, run the real beta release with the same prerelease parameter, then push with `git push --follow-tags origin beta`.

## External Systems / Dependent Platforms
- [08-19-fix-rd-guide-builtin-ref] Verify npm registry beta dist-tag and GitHub prerelease after CI publishes.
- [08-19-fix-rd-guide-builtin-ref] Clean-environment readback must verify the packaged `rd-guide` source uses `ref: main`.
- [08-19-fix-rd-guide-builtin-ref] End-to-end installation readback depends on rd-guide MR-2 being merged into `main`.

## Release Order
1. Ensure rd-guide MR-2 is merged before claiming end-to-end installation readback.
2. Run beta dry-run and obtain explicit owner approval.
3. Run the real beta release and push tags.
4. Verify npm, GitHub prerelease, packaged descriptor, and installation readback.

## Rollback Notes
- Before release: revert the task code commit normally.
- After release: do not rewrite published npm versions or tags; publish a corrective beta version if rollback is needed.

## Post-release Verification
- Verify the new package contains `src/builtin-marketplaces/rd-guide.json` with `ref: main`.
- Verify `flower-trellis plugin source list --json` or equivalent clean-environment readback resolves the built-in `rd-guide` source from `main`.
- After rd-guide MR-2 is merged, verify the target skill can be installed from the built-in source.
