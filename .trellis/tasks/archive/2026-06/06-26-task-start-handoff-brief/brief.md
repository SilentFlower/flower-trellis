# Brief — 增加任务启动交接摘要

## Goal

- 为 Trellis 任务从 planning 切到 in_progress 增加 `brief.md` 交接摘要，降低用户和 agent 重新细读三件套的成本。

## Scope

- 新增 `trellis-task-brief` skill，从最新 `prd.md`、`design.md`、`implement.md` 生成、更新、校验并在对话中展示 `brief.md`。
- 修改 0.6 workflow hub 和 planning / planning-inline / in_progress / in_progress-inline state，使 start 前展示 brief，进入实现前重述 brief 或提示缺失。
- 同步 skill-garden 源、`enhancements/0.6` 快照和当前 `.agents` / `.claude` 副本。

## Non-Goals

- 不重构 Trellis 任务生命周期，不改变 `task.py start` 的状态切换语义。
- 不把 brief 变成第四件套，也不用 brief 取代实现前读取三件套和 spec。
- 不要求历史任务批量补齐 `brief.md`。

## Key Context

- `brief.md` 是三件套派生产物；每次运行 skill 必须重新读取最新三件套，已有 brief 不能跳过同步。
- 写回 brief 后必须在当前对话展示正文；start review 展示完整 brief，in_progress 重述可压缩但不能失真。
- 0.6 workflow 注入链路需要支持新增 `planning-inline` state，否则 Codex inline planning 路径会漏掉 brief review。

## Acceptance

- `trellis-task-brief` 在 `.agents` / `.claude` / `enhancements/0.6` / skill-garden 源中一致。
- `.trellis/workflow.md` 和 0.6 overrides 都包含 brief handoff 规则，并覆盖 planning、planning-inline、in_progress、in_progress-inline。
- 修改三件套后再次运行 skill 会覆盖/修正 `brief.md`；三件套没有的旧 brief 内容不会被保留为事实。
- 验证旧任务缺少 `brief.md` 时不会阻断执行，只会提示读取三件套并建议回补。

## Next Step

- 完成一致性检查、语法校验和 workflow / skill 搜索验证，然后进入 Phase 2.2 check。
