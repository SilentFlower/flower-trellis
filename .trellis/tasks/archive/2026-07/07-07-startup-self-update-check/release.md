# Release Operations

## Conclusion
Release operations exist.

本任务包含项目配置变更和发布后项目重叠加要求，需要在发版说明中明确现有项目如何安装新的启动更新检查 hook。

## Evidence Checked
- task.json
- prd.md
- design.md
- implement.md
- implement.jsonl
- check.jsonl
- release.md: 原文件不存在
- git commits / changed files: `2b98110`, `ee1ddae`, `1f758aa`, `5b0bee9`

## Drift Check
Missing release.md. 已根据任务需求、实施计划和提交文件补充发布操作说明。

## SQL Changes
None

## Configuration Changes
- `.trellis/.flower-manifest.json` 新增并维护 `updateCheck` 策略与缓存字段。
- `flower-trellis update` / `init` 会向 Codex `.codex/hooks.json` 的 `SessionStart` 合并 `python3 -X utf8 .trellis/scripts/flower_update_hook.py`。
- `flower-trellis update` / `init` 会向 Claude Code `.claude/settings.json` 的 `SessionStart` `startup` matcher 合并 `python3 .trellis/scripts/flower_update_hook.py`。
- 现有项目需要运行项目重叠加命令后才会获得上述配置，例如 `flower-trellis update --target <dir> --no-update-check --force` 或由 `flower-trellis self-update --target <dir> --yes --project-only` 触发。

## Batch / Deployment Scripts / Data Repair
- 无 SQL、数据修复或后台任务。
- 发布后如需让现有 dogfood 项目立即具备 hook，需要执行或确认项目重叠加结果；本任务已在当前项目提交 `.claude/settings.json`、`.codex/hooks.json`、`.trellis/.flower-manifest.json` 和 `.trellis/scripts/flower_update_hook.py` 的 dogfood 同步。

## External Systems / Dependent Platforms
- `self-check` 远程探测依赖 npm registry 的 `flower-trellis` `dist-tags.latest` / `dist-tags.beta`。
- 发布新版本后，应确认 npm registry 的 dist-tags 指向符合预期，否则启动更新检查不会推荐正确通道。

## Release Order
1. 发布 npm 包并确认 `latest` / `beta` dist-tag。
2. 对需要立即启用该能力的现有项目运行 `flower-trellis update --target <dir> --no-update-check --force`，或运行 `flower-trellis self-update --target <dir> --yes --project-only`。
3. 启动 Codex / Claude Code 会话，确认无更新、离线或关闭检查时不注入噪音；有更新或项目不同步时注入 `<flower-update>`。

## Rollback Notes
- 回滚代码版本即可停止新增能力。
- 若单个项目需要移除启动 hook，可从 `.codex/hooks.json` / `.claude/settings.json` 删除 flower update hook 片段，并从 `.trellis/.flower-manifest.json` 删除或关闭 `updateCheck`。
- 若 `updateCheck` 策略写坏，可删除该字段恢复默认 `ask`，或运行 `flower-trellis update-check set|disable|enable --target <dir>` 重新写入。

## Post-release Verification
- `npm view flower-trellis dist-tags --json` 确认发布通道。
- `flower-trellis self-check --json --target <dir>` 在目标项目输出稳定 JSON。
- `flower-trellis self-update --target <dir> --dry-run --project-only` 显示项目更新命令默认包含 `--force`。
- 对 Codex / Claude Code 项目重复运行 `flower-trellis update --target <dir> --no-update-check --force` 后，确认 SessionStart hook 不重复。
