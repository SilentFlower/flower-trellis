# Brief — 启动时自更新检查

## Goal

- 在 Codex / Claude Code 启动 flower-trellis 项目会话时，检查当前安装版本、项目已铺版本和远程 flower-trellis 版本，并把可执行、可审计的更新建议注入给 AI；默认 `ask`，只有用户显式配置并满足安全条件时才允许自主更新。

## Scope

- 新增 `flower-trellis self-check --json --target <dir>`，始终输出稳定 JSON，区分 `update_available`、`project_out_of_sync`、`up_to_date`、`disabled`、`skipped`、`offline` 等状态。
- 新增 `flower-trellis self-update --target <dir> --yes [--dry-run]`，完成全局 flower-trellis 更新和目标项目完整 `flower-trellis update --target <dir> --no-update-check --force` 重叠加；仅项目不同步时支持 project-only 路径。
- 新增 `flower-trellis update-check get|set|disable|enable --target <dir>`，管理 `.trellis/.flower-manifest.json` 的 `updateCheck` 策略和检查缓存。
- 扩展 `.trellis/.flower-manifest.json`，保留现有 `flowerVersion`、`variant`、`version`、`skills`、`paths`，新增 `updateCheck.enabled`、`policy`、`intervalHours`、`lastCheckedAt`、`lastRemote`、`lastStatus`、`lastErrorCode`。
- 新增 `src/assets/flower_update_hook.py` 并由 flower-trellis 复制到目标 `.trellis/scripts/flower_update_hook.py`；Codex 和 Claude Code SessionStart 调用该 hook 注入 `<flower-update>` 块。
- Codex 合并 `.codex/hooks.json` 的 SessionStart；Claude Code 只挂 `SessionStart` 的 `startup` matcher，不挂 `clear` / `compact`。

## Non-Goals

- 启动 hook 不直接执行 `npm install -g`、`flower-trellis update` 或任何写入型更新。
- 不做 GUI、桌面通知、后台进程或定时任务。
- 不单独升级 `@mindfoldhq/trellis` 到远程最新版本；Trellis 版本跟随当前 flower-trellis 捆绑版本。
- 不修改 npm 发布流程和 CI Trusted Publishing。
- 不新增 flower 私有覆盖语义；默认使用上游已有 `--force`，对应用户常用的 “Apply Overwrite to all”。

## Key Context

- 版本来源：`src/lib/versions.js#flowerVersion()` 读 flower-trellis 包版本，`src/lib/versions.js#trellisVersion()` 读捆绑 Trellis 版本；项目已铺版本来自 `.trellis/.flower-manifest.json` 和 `.trellis/.version`。
- 本地一致性检查不受 `intervalHours` 限制：manifest 的 `flowerVersion` 与当前安装版本不同，或项目 `.trellis/.version` 与当前捆绑 Trellis 版本不同，都必须注入 `project_out_of_sync`。
- 只有 npm registry 远程探测受 `intervalHours` 节流；远程检查复用 `src/lib/update-check.js` 的 dist-tags、latest/beta、2.5s 超时、失败静默、npx / `FLOWER_NO_UPDATE_CHECK` 短路。
- 项目内容更新必须走完整现有链路：`syncGlobalTrellis()` → `trellis update` → `applyEnhancements()` → Codex / Claude 后处理 → manifest 更新，不能只改 manifest 或只覆盖单个 hook 文件。
- `self-update --yes` 里的 `--yes` 只确认 flower 自更新命令，不传给上游 `trellis update`；当前上游 `trellis update` 没有 `-y`。项目 update 默认追加 `--force`；如果用户在 `--` 后显式传入 `--skip-all`、`--create-new` 等上游冲突策略，则以用户透传为准。
- `policy=auto` 必须满足目标是 Trellis 项目、git clean、无 active/in_progress Trellis 任务、命令可用、未设置 `FLOWER_NO_UPDATE_CHECK` 等安全条件；否则降级为 `ask`。

## Acceptance

- Codex 和 Claude Code SessionStart 在 `update_available` 或 `project_out_of_sync` 时注入 flower 更新状态；无更新、离线、关闭检查时不打扰。
- `self-check --json` 在有更新、无更新、离线、npx、关闭检查、manifest 缺失等场景下始终输出稳定 JSON。
- 本地项目版本不一致时，即使远程检查 interval 未到，也会注入项目需要更新 / 重叠加的提示。
- `self-update --dry-run` 只预览命令、路径、版本和安全检查，不写入。
- `self-update --yes` 成功时完成全局 flower 更新和目标项目完整 `flower-trellis update --force` 重叠加；失败时给出明确手动命令，不吞掉错误。
- `update-check get|set|disable|enable` 能管理 `.trellis/.flower-manifest.json` 的策略；`disable` 不改 `policy`，`enable` 沿用原 `policy`。
- `init` / `update` 对已有 Codex / Claude Code 项目重复运行后 hook 配置幂等，不重复、不覆盖非 flower 管理的 hook。
- README、CLI help、语法检查和临时目标 dogfood 验证通过。

## Next Step

- 等用户确认 planning artifacts 和本 brief 后，运行 `task.py start` 进入实现；实现前先按 `trellis-before-dev` 读取 flower-trellis CLI 相关 spec，再按实施计划修改 manifest、版本检查、CLI 命令、hook 资产和平台后处理。
