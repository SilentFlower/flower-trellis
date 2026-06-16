# 升级 flower-trellis 到 Trellis 0.6.0 - 设计

## Technical Design

升级分为三层：

1. 依赖层：将 `@mindfoldhq/trellis` 固定到 `0.6.0`，让 flower-trellis 的 bundled Trellis 版本进入正式版。
2. 本仓 Trellis 模板层：用 Trellis 0.6.0 更新 `.trellis/`、`.claude/`、`.codex/`、`.agents/` 生成文件；对被判定为本地修改的文件手动合并，不能强制丢弃本仓配置。
3. flower 增强层：调整 `src/lib/codex-tweaks.js`。`multi_agent_v2` 注释逻辑保留为旧版本兼容清理，但 0.6.0 下不应是核心行为；`hooks.json` 改为合并而不是覆盖，避免丢掉上游 UTF-8 与 timeout 设置。

## Compatibility

- Codex hook 命令中 `{{PYTHON_CMD}}` 是 Trellis 模板占位符，生成到项目后通常会被替换成实际 Python 命令；flower 后处理应兼容现有 `python3` 与上游模板命令。
- `.trellis/config.yaml` 是用户修改文件，必须保留本仓 `packages` 与 `default_package`，同时加入上游 `channel.worker_guard`。
- skill-garden workflow 增强仍保留，因为它约束提交确认、路由和 finish-work，不与 Trellis 0.6.0 的 archive bugfix 重叠。

## Rollback

- 依赖回滚：将 `@mindfoldhq/trellis` 改回 `0.6.0-beta.8` 并恢复 lockfile。
- 模板回滚：Trellis update 会生成 `.trellis/.backup-*`，也可用 git 回滚本次改动。
- Codex 后处理回滚：恢复 `src/lib/codex-tweaks.js` 到覆盖式写入。
