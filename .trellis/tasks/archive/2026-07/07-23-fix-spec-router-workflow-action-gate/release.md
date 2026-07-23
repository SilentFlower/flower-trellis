# Release Operations

## Conclusion

Release operations exist.

## Evidence Checked

- `task.json`
- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`
- flower-trellis business commit `b8dd135`
- skill-garden source commit `c1b31b5`
- Current Git status and branch/upstream state

## Drift Check

Missing `release.md`; the task artifacts consistently require a fresh release dry-run and a new explicit confirmation after the Workflow Gate fixes are merged.

## SQL Changes

None.

## Configuration Changes

None.

## Batch / Deployment Scripts / Data Repair

- Re-fetch the current npm `beta` dist-tag and remote release/tag state.
- Re-run the `0.6.0-beta.0` release dry-run using the project release SOP.
- Present the regenerated CHANGELOG and release plan before any release commit, tag, npm publish, or GitHub release action.

## External Systems / Dependent Platforms

- npm registry: verify the current `beta` dist-tag before release.
- GitHub repository: verify remote tags/releases before release.
- No external mutation is authorized until the user gives a new explicit release confirmation.

## Release Order

1. Fetch npm and remote GitHub state.
2. Run the `0.6.0-beta.0` release dry-run.
3. Present the resulting CHANGELOG, commit/tag/publish plan, and verification steps.
4. Wait for explicit user confirmation before executing release mutations.

## Rollback Notes

No release mutation has been performed by this task. Roll back the code commits only if the Workflow Gate fix itself must be reverted; follow the release SOP if a later release operation needs rollback.

## Post-release Verification

- Verify npm `beta` resolves to the newly confirmed version.
- Verify the Git tag and GitHub release point to the intended release commit.
- Reinstall or apply the published enhancement and confirm the Workflow Gate reachability scenarios remain valid.
