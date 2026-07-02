# Release Operations

## Conclusion
Release operations exist.

## Evidence Checked
- task.json
- prd.md
- design.md
- implement.md / implement.jsonl / check.jsonl
- release.md: missing before finish-work
- git commits: e05c3cf, 5584b6d, c0db9bd
- changed files from `git show --name-only`
- `node scripts/check-snapshot.mjs`
- `.trellis/spec/flower-trellis/cli/release-and-publishing.md`

## Drift Check
Missing release.md. Created during finish-work from task artifacts and git evidence.

## SQL Changes
None.

## Configuration Changes
- `package.json` and `package-lock.json` now bundle `@mindfoldhq/trellis@0.6.5`.
- `.trellis/.version` and dogfood Trellis templates were updated to 0.6.5.
- `vendor/skill-garden` submodule pointer was updated to `c0db9bd`.
- `node scripts/check-snapshot.mjs` currently reports `enhancements/MANIFEST.json` `sourceCommit=57bac1361b` while `vendor/skill-garden` is at `c0db9bd681`; run `npm run sync`, review the manifest-only snapshot diff, commit it, then rerun `node scripts/check-snapshot.mjs` before any npm release.

## Batch / Deployment Scripts / Data Repair
- No data repair, SQL migration, scheduled job, or batch rerun is required.
- Publishing the package requires the normal flower-trellis release flow:
  1. Run `npm run sync`.
  2. Commit the resulting `enhancements/MANIFEST.json` snapshot pointer update if it is the only diff.
  3. Run `node scripts/check-snapshot.mjs` and require it to pass.
  4. Run the appropriate `npm run release:dry` command and show the generated CHANGELOG.
  5. After human confirmation, run the matching `npm run release...` command.
  6. Push commits and tags so GitHub Actions publishes to npm through OIDC.

## External Systems / Dependent Platforms
- npm package `flower-trellis`.
- GitHub Releases / GitHub Actions `release.yml`.

## Release Order
1. Complete the snapshot sourceCommit sync and commit.
2. Pass `node scripts/check-snapshot.mjs`.
3. Follow the documented dry-run, confirm, release, push-tags flow.

## Rollback Notes
- Code rollback: revert `e05c3cf` in `flower-trellis` and `c0db9bd` in `skill-garden`, then resync `enhancements/0.6`.
- If a package release has already been published, follow npm deprecation / follow-up release policy instead of deleting history.

## Post-release Verification
- `npm view flower-trellis version`
- `npm view flower-trellis dist-tags --json`
- Install or run the published package and verify `flower-trellis -v` reports bundled Trellis `0.6.5`.
