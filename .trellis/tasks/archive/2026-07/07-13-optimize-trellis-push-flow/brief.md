# Brief — 简化 Trellis 提交、进度与收尾流程

## Goal

- 把 `trellis-push` 收缩为最小的任务相关 commit/push 流程，同时保留每次普通 push 后立即同步到远端的任务进度。

## Scope

- 保留 post-check stop、Phase 3.3 和 Phase 3.4 唯一 `trellis-push` 入口；禁止主 agent 自制提交旁路。
- `trellis-push` 计划和结果沿用原有总览/分仓视觉结构，只保留精简后的 commit/push/progress，并只确认一次。
- retained 是内部术语，用户输出统一写“保留未提交的变更（dirty）”，标注 untracked/unstaged/staged，并与真正风险分区。
- 分仓标题显示真实 package/仓库名，不显示内部 `root` / `parent` 别名。
- 普通模式使用 exact `git commit --only` 后 push；显式 commit-only 不 push；merge 完全移出。
- 每次普通 push 完成或部分完成后，独立 commit/push 当前任务最小 `progress`：updatedAt、completedSteps、partialStep、nextStep、notes。
- 新 `task_progress.py` 兼容读取 legacy `last_push_snapshot`，下一次写入时迁移；不再记录 push_mode 或业务 commit hash。
- auto-loop 保留 commit-only profile/action；`trellis-auto-loop` 管 runner 校验和 record，`trellis-push` 只执行内部 exact commit-only。
- finish-work 自动调用 `trellis-release audit-current`，精确提交 archive/journal，并只按开始时 upstream/ahead 基线决定是否自动 push。
- 多仓库按同一 commit/push 流程顺序执行；部分成功也同步远端 progress，避免恢复时重复操作。
- 从 vendor 源修改，运行 `npm run sync` 后同步 enhancements、workflow、脚本和当前平台副本，并更新项目 spec。
- workflow hub/state 属于 AI 控制协议，保留既有英文正文和稳定术语，不做整段中文翻译。
- workflow hub 只保留提交门禁，并明确详细计划/结果格式完全由 `trellis-push` 管，不复制模板细节。

## Non-Goals

- 不为 auto-loop 增加远端 push 授权。
- 不在 `trellis-push` 中执行 merge、release、部署或生产数据操作。
- 不自动解决 push rejection、merge/rebase 冲突或凭证问题。
- 不修改官方 `@mindfoldhq/trellis` npm 包源码。

## Key Context

- 当前 `trellis-push` 已超过 500 行，复杂度主要来自 merge、snapshot/bookkeeping、auto-loop runtime 和 finish-work 联动。
- Git push 是分支级操作；未知历史 ahead commits 仍必须显式处理，不能通过 exact files 排除。
- 普通计划外 untracked/unstaged/staged 文件可由 `git commit --only` 隔离，不应阻塞当前任务。
- 任务进度必须立即远端同步，因此接受普通 push 后额外产生一个固定格式 progress commit。
- finish-work 的 release 证据规则移入 `trellis-release audit-current`；普通批次上线单模式保持不变。
- 关键源位于 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6` 是发布快照。

## Acceptance

- 普通 push 只做一次最小确认，完成 exact business commit/push 和独立 progress commit/push。
- commit-only 与 auto-loop 只本地提交，不触发远端 progress。
- merge、snapshot JSON、push_mode、父仓 snapshot bookkeeping 和 runner 状态解析退出 `trellis-push`。
- 全部成功和部分成功/失败均产生准确的远端 progress；旧 snapshot 可迁移。
- finish-work 不读取 progress/push_mode，不受其他任务 dirty 文件影响，并按 Git 基线安全自动 push。
- `trellis-release audit-current` 可自动完成单任务上线核对，普通 release 批次流程不退化。
- vendor、enhancements、当前副本和 workflow 语义一致，所有静态与场景验证通过。

## Next Step

- 等待用户审核本 brief 与最新 PRD/design/implement；确认后复用当前任务 implement route 进入实现。
