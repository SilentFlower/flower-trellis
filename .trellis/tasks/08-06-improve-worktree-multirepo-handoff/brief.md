# Brief — 改进 Worktree 多仓基线确认与会话交接

## Goal

- 让用户创建并行 worktree 前明确确认根仓基线、来源 dirty 和本地状态边界，在 harness 多仓目录中不混淆根仓、子仓或旧会话状态。

## Scope

- 将 `worktree create` 改为两阶段：无 `--yes` 时只读返回 `confirmation-required`，真实创建必须携带 `--yes --plan-fingerprint`；参数、dirty 或可继承偏好变化后返回 `create-plan-changed` 且零写入。
- 未传 `--base` 时默认使用来源根仓当前分支，detached HEAD 回退 `HEAD`；计划展示来源仓、解析 commit、目标 branch/path 和 task。
- 预检展示来源根仓 tracked dirty、staged、untracked、conflict，并明确这些内容不会进入目标 commit。
- 展示选定根仓 commit 的 submodule；Skill 结合 package context 分别说明独立 Git package，不从根仓分支推断子仓基线。
- `create` 仅为同一开发者继承规范化 route 个人偏好；`prepare` 仅在显式 `--inherit-route-prefs`、同 Git common-dir、同开发者时继承，并保留目标已有偏好。
- session、current task、auto-loop、pre-check、Flower 本机 ownership state、平台私有设置和缓存均不继承；目标 runtime 为空创建。
- handoff 返回目标 `cwd` / `workspaceRoot` 和 `requiresNewSession=true`，要求在目标 workspace 重新启动或重绑 AI 会话。
- 同步 canonical engine、Flower facade/help、Codex/Claude Skill、enhancements 快照、规格和测试。

## Non-Goals

- 不自动复制、stash、commit 或应用来源 working tree 的未提交内容。
- 不自动为 submodule 或独立 Git package 创建 worktree、checkout 或业务分支，也不自动选择远程默认分支。
- 不复制 `.flower/state.json`、`.claude/settings.local.json`、session runtime、活动任务、auto-loop、cache、transaction、backup 或故障证据。
- 不修改客户端实现旧会话原地重绑定，不改变 task、check、push、remove 等生命周期。
- `rd-guide` HTTPS 修改不属于本任务。

## Key Decisions

- engine 生成 machine-readable plan 和稳定 fingerprint，Skill 负责展示并取得用户对最新计划的确认；真实写入重新计算 fingerprint，关闭确认后的状态漂移窗口。
- Git commit 是目标内容唯一事实源；来源 dirty 只披露、不阻断，也不会被隐式带入目标。
- route 偏好采用严格 allowlist，只接受 `implement` / `check` 的合法枚举，不复制原文件、未知字段或任意 `*.tmp`。
- `create` 自动继承仅限同一开发者；`prepare` 必须显式请求并验证同仓、同开发者，目标已有偏好优先。
- 根 harness 仓是本次创建对象，子仓只展示和分别确认；新会话只读取目标 worktree 自己的 Trellis、平台和 Flower 文件。
- 真实 create 复用同一 plan 校验，并保留现有 registry 锁、事务顺序和失败回滚。

## Key Context

- Canonical engine：`vendor/skill-garden/.trellis/0.6/scripts/worktree_setup.py`；稳定 Git 状态解析可复用同目录 `git_evidence.py`。
- Flower facade/help：`src/commands/worktree.js`、`src/cli.js`。
- route 合法值契约：`.agents/skills/trellis-route/scripts/route_state.py` 和 `enhancements-model.md`。
- Canonical Skill：vendor 下 Codex/Claude `trellis-worktree/SKILL.md`，通过 `npm run sync` 投影到 `enhancements/0.6` 和 dogfood 入口。
- 行为规格：`.trellis/spec/flower-trellis/cli/config-and-state.md` 的 Branch-Local Trellis Worktree 场景。
- 核心测试：`test/python/test_worktree_setup.py`、`test/js/worktree-cli.test.js`。

## Risks / Deferred

- 历史自动化从直接写入改为预检，并新增 fingerprint，属于有意的破坏性安全收紧；help、Skill 和错误矩阵必须同步。
- fingerprint 包含 dirty 和 route 偏好，稳定排序或 DTO 漂移可能造成无意义的重新确认，必须用测试锁定。
- task `base_branch` 将优先记录当前分支名；detached HEAD 仍记录 `HEAD`。
- submodule inventory 只说明，不触发 fetch、checkout 或分支创建；独立 Git package 继续由 Skill 读取 package context。
- `.flower/state.json` 不复制，目标 Flower ownership state 由目标自己的后续 Flower 生命周期重建。

## Acceptance

- 无 `--yes` 的 create 返回完整只读计划且 Git、目标目录、task、runtime、registry 零变化；最新 fingerprint 匹配后才允许写入。
- 默认/改选 base、来源仓身份、submodule、dirty 摘要和本地状态 transfer plan 在 JSON 与人类输出中一致。
- dirty 或 route 偏好变化使旧 fingerprint 失效，返回 `create-plan-changed` 且零写入。
- `create` 仅同开发者继承规范化 route 偏好；`prepare` 显式继承满足同仓、同开发者且不覆盖目标偏好。
- `.flower/state.json`、`.claude/settings.local.json`、session/auto-loop/cache 等明确不复制。
- `--yes --plan-fingerprint` 后保持现有 worktree/task/registry 创建顺序、回滚与 handoff 安全。
- canonical、snapshot、双平台 Skill、规格和测试一致，定向与完整质量门禁通过。

## Next Step

- Brief 获得确认后运行 `task.py start`，再由 `trellis-route(target=implement)` 选择实现执行位置。
