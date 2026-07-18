# Brief — 优化 Trellis Task 意图识别与切换

## Goal

- 让 Trellis 自动识别讨论、检查、直接修改、task planning 和显式工作流动作，支持自然语言切换；同时把 skill-garden 0.6 升级为可安全执行 `insert / replace / remove` 的声明式注入系统，彻底替换机械 task-creation consent。

## Scope

- 在 flower-trellis 新增两阶段 transform engine：required 变换先零写入 preflight，再按 managed marker 幂等应用；workflow/skill/command/hook、marker style、首次备份、optional skip、路径限制和 manifest 最后写入均为强制契约。
- 在 skill-garden 0.6 声明 workflow、Codex/Claude SessionStart、`trellis-start`、`trellis-brainstorm` 的精确变换，替换 Phase 摘要、Request Triage、no_task、Phase 1 walkthrough 和 customization invariant 中的机械询问。
- 新增 `task_intent.py`，负责自动 task 创建标记、Git dirty baseline，以及仅对当前请求自动创建且满足全部安全条件的 planning task 执行 discard；create/discard 中途失败补偿恢复 task、parent 与 session。
- 支持当前请求内 `先讨论 / 不要任务 / 走任务 / 直接做` 等自然语言切换；direct edit 切回 task 时保留并登记已有 dirty changes。
- 引入 Node `node:test`、Python `unittest` 和统一 `npm test`，覆盖变换、流水线顺序与安全删除。
- 新增 `trellis-injection-transforms.md` 和 `ai-context-budget.md` 两份独立 spec；context budget 默认分级告警，结构错误失败，发布审计可显式 `--strict`。
- 按 skill-garden 源提交并推送 → flower `npm run sync` → snapshot/dogfood/spec/submodule pin 的顺序完成双仓交付。

## Non-Goals

- 不修改 `task.py create/start` 的既有状态转换，不新增 `cancelled` 状态。
- 不自动执行生产、部署、数据库、凭证或外部系统操作。
- 不提供无锚点宽泛正则、通配 target、任意模板脚本或整文件覆盖。
- 不为临时意图切换增加跨请求持久偏好。
- 不为 0.5/old 引入同等变换能力，也不修改官方 `@mindfoldhq/trellis` 源码。

## Key Context

- 当前冲突证据集中在 `.trellis/workflow.md:275`、`:280-284`、`:304-321`、`:504-508`、`:847`，以及 `.agents/skills/trellis-start/SKILL.md:50`、`.agents/skills/trellis-brainstorm/SKILL.md:28`。
- `src/lib/workflow-inject.js` 与 `skill-override-inject.js` 目前只追加；`src/lib/apply-enhancements.js` 当前在注入前写 manifest，需要调整顺序。
- 变换声明真实源位于 `vendor/skill-garden/.trellis/0.6/overrides/transforms/`；flower 执行器位于 `src/lib/`，快照由 `npm run sync` 生成。
- 自动 discard 必须同时证明：当前请求自动创建、当前 session active、仍为 planning、无 children/subtasks、无 commit/PR/worktree/progress、未被 Git versioned、未进入实施；任一不满足即零副作用拒绝。
- 规划前 AI context 基线：workflow `56,635` bytes、hub `10,757`、当时五个 state `8,546`、Phase summary `17,935`、SessionStart 样本 `17,841`。修复后实测为 workflow `59,521`、hub `12,022`、当前四个 state `7,827`、Phase summary `20,117`、SessionStart `19,446` bytes；后三项为 warning、均未超过 review ceiling。预算只默认告警，不因大小阻断 `npm test`。
- `vendor/skill-garden` 是独立 submodule；flower commit 引用的 skill-garden commit 必须先提交并推送，禁止提交脏 submodule 或只改生成快照。

## Acceptance

- discuss/inspect 不再询问 task；复杂实施可自动创建 planning task，但 brief/start/route/check/push/finish-work 与高风险门禁无回归。
- 自然语言切换只影响当前请求；安全 task discard 清理目录、父引用和 session，拒删分支不触碰其它 task、session 或业务 dirty changes。
- `insert / replace / remove` 严格校验声明、路径、marker style 和预期次数；required 漂移零写入失败且不更新成功 manifest，重复应用无额外 diff。
- workflow、SessionStart、start、brainstorm 与已启用平台副本不再残留机械 task-creation consent，create/discard helper 实际接通，同时保留必要确认。
- `npm test`、JS/Python 语法、sync、snapshot、dogfood 幂等和残留扫描通过；context checker 输出 actual/target/review ceiling，默认告警，结构错误失败。
- 两份新 spec 已进入 CLI index，0.5/old 与官方 Trellis 无语义漂移。

## Next Step

- 进入双仓 `trellis-push`：先提交并 push skill-garden，再运行 `npm run sync` 更新 flower snapshot/submodule pin，提交并 push flower，最后同步当前任务进度。
