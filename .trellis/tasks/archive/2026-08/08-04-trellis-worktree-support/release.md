# Release Operations

## Conclusion

Needs human review.

本任务已经提交并推送代码、Skill-Garden 子仓和 `enhancements/0.6` 快照改动。是否对外发布到 npm / GitHub Release 需要按 flower-trellis 发版 SOP 另行确认；finish-work 不执行发布动作。

## Evidence Checked

- `task.json`
- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`
- `release.md`: missing before finish-work
- Git commits / changed files:
  - `e5953b3 feat(trellis): support linked worktree entry setup` in `vendor/skill-garden`
  - `5af8e7a feat(trellis): support linked worktree entry setup` in `flower-trellis`
  - `44301d5 chore(task): update trellis-worktree-support progress`

## Drift Check

Missing `release.md`;任务材料、检查记录和提交证据一致显示本任务修改了 packaged enhancement assets、Skill-Garden 0.6 模板、hook compiled targets 和 submodule pin。正式发版前需要人工确认发布通道与版本。

## SQL Changes

None

## Configuration Changes

None

## Batch / Deployment Scripts / Data Repair

None

## External Systems / Dependent Platforms

- npm package `flower-trellis`: 下游用户只有在安装 / 更新到包含 `5af8e7a` 的版本后，才能获得 `trellis-worktree` skill、`worktree_setup.py` 和 linked worktree fallback。
- GitHub Release / tag: 如果发布新版本，tag 必须指向包含 `vendor/skill-garden` submodule pin `e5953b3` 且 `enhancements` 快照一致的父仓提交。
- `vendor/skill-garden`: 子仓 `beta` 已推送到 `e5953b3`，父仓快照和 submodule pin 已通过 `node scripts/check-snapshot.mjs` 校验。

## Release Order

1. 决定是否发布 beta 或 stable。
2. 按 `.trellis/spec/flower-trellis/cli/release-and-publishing.md` 先运行对应 dry-run。
3. 展示生成的版本、CHANGELOG 和发布计划，等待新的明确确认。
4. 发布前再次运行 `npm run sync`、`node scripts/check-snapshot.mjs` 和项目 release SOP 要求的验证。
5. 执行真实 release，并按 SOP 推送 commit / tag。

## Rollback Notes

未发布前可回滚代码提交和 submodule pin。若已经发布，应发布后续版本回退 `trellis-worktree` skill、`worktree_setup.py`、hook fallback、`untracked_flow.py` fallback 和同步快照。

## Post-release Verification

- 验证 npm dist-tag 指向预期版本。
- 在临时 Trellis 项目中安装 / 更新后，确认 `.agents/skills/trellis-worktree/SKILL.md`、`.claude/skills/trellis-worktree/SKILL.md` 和 `.trellis/scripts/worktree_setup.py` 存在。
- 在 linked worktree 场景中验证 `worktree_setup.py status/prepare --target <linked> --json` 行为符合任务 acceptance。
