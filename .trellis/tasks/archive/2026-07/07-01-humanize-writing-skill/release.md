# Release Operations

## Conclusion
Release operations exist.

## Evidence Checked
- task.json
- prd.md
- design.md / implement.md / implement.jsonl / check.jsonl
- release.md was missing before finish-work
- git commits / changed files:
  - `3413628 feat(skill): 支持安装 humanize-writing 增强技能`
  - `2023c3f feat(0.6): 新增 humanize-writing 中文润色技能`
  - `1c02041 chore(task): update humanize-writing-skill push snapshot`

## Drift Check
Missing release.md. Created during finish-work from task files and commit evidence.

## SQL Changes
None

## Configuration Changes
None

## Batch / Deployment Scripts / Data Repair
None

## External Systems / Dependent Platforms
None

## Release Order
1. Ensure `vendor/skill-garden` source commit is pushed and the parent repository submodule pin points to it.
2. Ensure `npm run sync` has generated `enhancements/0.6` and `enhancements/MANIFEST.json` from that source commit.
3. Run `node scripts/check-snapshot.mjs` before any npm release.
4. Follow `.trellis/spec/flower-trellis/cli/release-and-publishing.md` for beta or stable release:
   - run the matching `npm run release:dry...` first and review the generated CHANGELOG;
   - after user confirmation, run the matching real release command;
   - push the generated tag so GitHub Actions publishes the npm package.

## Rollback Notes
Rollback code only before npm release. After npm release, publish a follow-up version that removes or corrects the `humanize-writing` enhancement and CLI behavior as needed.

## Post-release Verification
Verify according to task acceptance criteria:

- `ft skill list` shows `humanize-writing` for Trellis 0.6 targets.
- `ft skill install humanize-writing` installs only that enhancement.
- Installed `.agents/skills/humanize-writing/SKILL.md` and `.claude/skills/humanize-writing/SKILL.md` contain the complete Chinese-localized rule system, including self-check and anti-pattern sections.
- `node scripts/check-snapshot.mjs` passes before release.
