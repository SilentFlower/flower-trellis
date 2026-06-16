# 升级 flower-trellis 到 Trellis 0.6.0

## Goal

将 flower-trellis 捆绑的 `@mindfoldhq/trellis` 从 `0.6.0-beta.8` 升级到 `0.6.0` 正式版，并修正升级后会覆盖本仓增强逻辑的兼容点。

## Requirements

- `package.json` / `package-lock.json` 使用 `@mindfoldhq/trellis@0.6.0`。
- 保留 flower-trellis 的 Codex `SessionStart` hook 增强，但不要整文件覆盖上游 `.codex/hooks.json`。
- 合并上游 Codex hook 命令里的 UTF-8 与 timeout 改进。
- 移除或降级对 `[features.multi_agent_v2]` 的强制注释逻辑，避免与 Trellis 0.6.0 已移除该配置的设计冲突。
- 跑 Trellis 0.6.0 本地更新，新增正式版模板文件；手动保留本仓 `.trellis/config.yaml` 的 packages/default_package 配置。
- 回答 `last_push_snapshot` 在父仓存在未确认 dirty 文件时不自动写入的设计原因。

## Acceptance Criteria

- [x] `flower-trellis -v` 或等价版本读取显示捆绑 Trellis 为 `0.6.0`。
- [x] `.codex/hooks.json` 后处理保留 `SessionStart`，并保留/继承上游 `UserPromptSubmit` 设置。
- [x] `.trellis/config.yaml` 同时包含上游 `channel.worker_guard` 与本仓 `packages/default_package`。
- [x] Trellis 0.6.0 新增的 channel / session-insight / spec-bootstrap 等模板进入本仓。
- [x] 执行可用的质量检查。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
