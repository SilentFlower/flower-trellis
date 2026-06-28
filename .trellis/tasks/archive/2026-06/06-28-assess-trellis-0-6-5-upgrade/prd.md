# 评估 Trellis 0.6.5 升级

## 目标

评估 flower-trellis 从 `@mindfoldhq/trellis@0.6.2` 升级到 `0.6.5` 的影响，找出会和当前 flower-trellis / skill-garden 0.6 强化包产生明显冲突的点，并形成后续升级实施依据。用户确认进入实际升级后，本任务同时覆盖 0.6.5 依赖升级、workflow / skill-garden 合并、当前 dogfood 副本同步和质量验证。

## 背景

- 当前 `package.json` 和 `package-lock.json` 固定 `@mindfoldhq/trellis@0.6.2`，`@mindfoldhq/trellis-core@0.6.2`，项目 `.trellis/.version` 也是 `0.6.2`。
- 当前仓库已经有大量 skill-garden 0.6 覆盖：workflow hub、workflow-state guard、`trellis-route`、`trellis-push`、`trellis-finish-work` override、`trellis-task-brief` 等。
- 上次 0.6.0 / 0.6.2 升级时已确认：不能强制覆盖 `.trellis/workflow.md`、`.trellis/config.yaml`、Codex hooks 或 skill-garden 覆盖源；必须保留本仓本地配置与强化语义。
- 当前 flower-trellis 自带平台选择菜单和 `PLATFORM_FLAGS`，需要随 Trellis upstream 平台名变动保持基本对齐。
- 详细研究记录见 `research/trellis-0-6-5-upgrade.md`。

## 需求

- 对比 npm 包 `@mindfoldhq/trellis@0.6.2` 与 `0.6.5`，不能只看版本号或 changelog。
- 对比 `@mindfoldhq/trellis-core@0.6.2` 与 `0.6.5`，确认 core API / mem / channel 变化是否影响现有 skill。
- 运行 `npx --yes @mindfoldhq/trellis@0.6.5 update --dry-run`，记录真实会被自动更新和需要人工决策的文件。
- 重点识别与以下本地改动的冲突：
  - skill-garden 0.6 workflow hub / workflow-state guard。
  - finish-work skill override 和 `trellis-push` gate。
  - `.trellis/config.yaml` 本地 `packages` / `default_package` / `codex.dispatch_mode`。
  - `.codex/hooks.json` 的 SessionStart 合并策略。
  - flower-trellis 平台选择菜单和平台 flag 列表。
  - `.trellis/scripts` 中被 Trellis update 自动更新的 Python runtime。
- 输出建议升级路径：哪些文件可自动接受上游，哪些必须手工合并，哪些需要同步 skill-garden 源 / enhancements 快照 / 当前 dogfood 副本。

## 验收标准

- [x] 创建 Trellis 任务跟踪本次升级研究。
- [x] 记录当前版本基线：`package.json` / lockfile / `.trellis/.version` 均为 0.6.2。
- [x] 下载并解包 0.6.2 与 0.6.5 的 `@mindfoldhq/trellis` 和 `@mindfoldhq/trellis-core` npm 包。
- [x] 运行 0.6.5 `trellis update --dry-run` 并记录冲突文件。
- [x] 形成明显冲突清单和建议处理策略。
- [x] 已补齐 `design.md` / `implement.md`。
- [x] 用户确认进入实际升级实现；已使用 `trellis-task-brief` 生成 brief，并通过 `task.py start` 启动任务。
- [x] `package.json` / `package-lock.json` 已把 `@mindfoldhq/trellis` 和 lockfile 内 `@mindfoldhq/trellis-core` 升级到 `0.6.5`。
- [x] `.trellis/.version` 与 `node bin/flower-trellis.js -v` 已确认 project / bundled Trellis 均为 `0.6.5`。
- [x] flower 平台列表已支持 `--devin`、`--zcode`、`--trae`，保留 `--windsurf`，并明确不把 `--with-statusline` 当作平台 flag。
- [x] workflow 已合并 0.6.5 平台矩阵、JSONL ready gate 与 pull-based dispatch 分类，同时保留 skill-garden hub 和 route/push/brief gate。
- [x] `trellis-route` 已修复同一 session 切换任务后 runtime route 决策串用问题：写入新任务 implement/check 决策时清理其他任务的 `route_decisions`，不把该判断扩散到高频 workflow 文案。
- [x] finish-work skill / command 仍包含 skill-garden release operations override。
- [x] `.trellis/config.yaml` 与 `.codex/hooks.json` 已人工核对，保留 package 配置、`codex.dispatch_mode: sub-agent`、`UserPromptSubmit` 和 `SessionStart`。
- [x] 最终质量检查已通过，当前停在 Phase 3.4 前；提交必须通过 `trellis-push` 生成计划，不裸 `git add` / `git commit`。

## 研究摘要

明显冲突：

- `.trellis/workflow.md`：0.6.5 上游新增平台矩阵、JSONL ready gate、pull-based dispatch 分类；但本仓 workflow 有 skill-garden hub 和 route/push/brief 覆盖，不能直接覆盖。
- `.trellis/config.yaml`：dry-run 标记为 modified by you；升级时必须保留 `packages`、`default_package` 和 flower 强制的 `codex.dispatch_mode: sub-agent`。
- `.codex/hooks.json`：dry-run 标记为 modified by you；flower 只应继续保留上游 UserPromptSubmit 并补 SessionStart，不能整文件覆盖。
- `.agents/skills/trellis-finish-work/SKILL.md` 和 `.claude/commands/trellis/finish-work.md`：dry-run 标记为 modified by you；这些承载 skill-garden finish-work release override，不能被上游模板覆盖掉。
- 平台列表：0.6.5 新增 `--zcode`、`--trae`、`--with-statusline`，把 Windsurf 主名改为 Devin，并保留 `--windsurf` deprecated alias；当前 flower 平台菜单和 `PLATFORM_FLAGS` 尚未对齐。

建议升级时自动接受：

- `.trellis/scripts/common/active_task.py`
- `.trellis/scripts/common/cli_adapter.py`
- `.trellis/scripts/common/task_store.py`
- `.trellis/scripts/common/workflow_phase.py`
- `.trellis/scripts/common/safe_commit.py`
- `.trellis/scripts/add_session.py`
- 上游自动更新的 `trellis-meta`、`trellis-session-insight`、`trellis-brainstorm`、`trellis-break-loop` 等非 skill-garden 自定义覆盖文件。

建议升级时手工合并：

- `.trellis/workflow.md`
- `.trellis/config.yaml`
- `.codex/hooks.json`
- finish-work skill / command 覆盖文件。

## 不在范围内

- 不提交代码；提交必须在 Phase 3.4 通过 `trellis-push` 完成。
- 本任务不评估 0.5 / old 强化包变体迁移。
- 本任务不实现 auto loop 功能。
