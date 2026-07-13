# Brief — 优化 Trellis 提交与推送流程

## Goal

- 保持普通 `check-all` 后 Phase 3.3 的现有时机，并确保进入 Phase 3.4 时使用默认 push 的 `trellis-push` 计划，禁止 AI 绕过该入口自行拼装提交，同时以紧凑、可复核的排版覆盖大型、多仓库和无任务场景。

## Scope

- 保留 post-check stop gate 与 Phase 3.3 现有触发方式；post-check 只报告质量结论、验证结果、剩余风险和下一步，然后等待用户继续。
- 既有 Phase 3.3 完成并进入 Phase 3.4 时必须生成 `trellis-push` 计划，Git 写操作仍等待一次确认。
- 强化 `trellis-push` 唯一入口、普通默认 push、显式 commit-only、commit message 生成与一次确认契约。
- 固化终端排版：顶部总览、逐仓扁平区块、Spec review/验证/snapshot 单行摘要、风险独立展开。
- 每仓库 8 个文件以内完整显示；超过 8 个按目录归组，文件区最多 12 行，支持 `展开文件`。
- 多仓库逐仓独立 commit/push、统一确认；无任务时跳过 spec/snapshot/bookkeeping，并默认排除无法证明来源的 dirty 文件。
- 保持 auto-loop 唯一 `profile=commit-only`、`commit_only` action 和 runtime schema，不增加远端授权。
- 从 `vendor/skill-garden/.trellis/0.6/` 修改源文件，运行 `npm run sync` 后同步发布快照与当前 dogfood 副本，并更新项目 spec。

## Non-Goals

- 不为 auto-loop 新增 push profile 或远端 push 预授权。
- 不自动 merge、force push、release、部署或操作生产数据。
- 不自动解决 push rejection、merge/rebase 冲突或凭证问题。
- 不把 `trellis-push` 改造成独立 Git 客户端，也不取消精确暂存和普通模式确认。
- 不修改官方 `@mindfoldhq/trellis` npm 包源码。

## Key Context

- 普通 `trellis-push` 当前本就默认 push；问题是 check-all 后出现了绕过 skill 的自制 commit-only 计划。
- post-check 报告不得包含 commit message、拟提交文件、`Proposed commits` 或“回复 ok 提交”。
- 上游 workflow 下层仍有 `Proposed commits` / local-only / no-push 旧流程；强化 hub/state 必须明确整段禁用，由 `trellis-push` 完全替代。
- auto-loop 当前只有 commit-only，本任务明确保留该历史安全边界。
- 计划内部必须始终持有 exact planned/retained files；紧凑排版只影响展示，不得使用 `git add .` 或目录概括执行。
- 未识别 dirty、staged、冲突和跨任务文件始终逐项完整展示，不受 8 文件/12 行阈值影响。
- 关键源文件位于 `vendor/skill-garden/.trellis/0.6/.agents|.claude/skills/` 与 `overrides/workflow.md`；`enhancements/0.6` 是同步生成的发布快照。
- 实现不得改变 `.trellis/scripts/auto_loop.py` 的 profile/action schema；只做 auto-loop commit-only 回归验证和必要文案澄清。

## Acceptance

- 普通 check-all 后保持原有 Phase 3.3 时机；post-check 报告只包含质量结果并等待用户继续。
- 进入 Phase 3.4 时展示包含最近 Spec review 结论的 `trellis-push` 计划，不再出现自制提交旁路。
- 普通模式默认 commit + push，显式请求时才 commit-only；auto-loop 始终只本地 commit。
- 大型、多仓库、无任务和风险场景按已确认排版展示，且精确文件范围与重确认门禁不退化。
- commit message 只能由 `trellis-push` 最终草拟/采用，普通模式一次确认，auto-loop 结果报告实际 message/hash。
- vendor 源、`enhancements/0.6`、当前 `.agents` / `.claude` 和 workflow 语义一致；`npm run sync`、`git diff --check` 与场景验证通过。

## Next Step

- 用户确认 planning artifacts 与本 brief 后运行 `task.py start`；进入 Phase 2.1 时先执行 `trellis-route(implement)`，再按确认的路线实现。
