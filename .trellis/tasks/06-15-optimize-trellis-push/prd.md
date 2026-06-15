# 优化 trellis-push

## Goal

优化 `trellis-push` 的使用体验和可维护性，让它在提交、推送、可选合并、任务进度快照这些高风险步骤里更清晰、更少重复确认，并保持现有安全门禁不退化。

## Background / Known Context

- 用户提出“对于 `trellis-push` 想优化下”，已同意创建 Trellis 任务进入规划。
- 当前 `trellis-push` 是本地 skill 文档驱动，主文件为 `.agents/skills/trellis-push/SKILL.md`，`.claude/skills/trellis-push/SKILL.md` 内容一致。
- 同步源是 `vendor/skill-garden/.trellis/0.6/.../trellis-push/SKILL.md`，本仓 `enhancements/0.6/.../trellis-push/SKILL.md` 是发布快照，三者当前一致。
- `trellis-push` 当前覆盖：读取 package git 配置、检测 dirty 仓库、展示 diff、逐仓确认暂存、生成 commit message、push 当前分支、可选 merge 到目标分支、写入活动任务 `last_push_snapshot`，并额外提交/推送父仓快照。
- `.trellis/workflow.md` 的高优先级约束要求：代码提交/推送必须走 `trellis-push`；确认必须展示具体暂存文件列表和 commit message；确认前不能 `git add` / commit / push；禁止 `git add -A` / `git add .`。
- 本仓是 `flower-trellis` 主仓 + `vendor/skill-garden` submodule。若改 skill-garden 强化包，应优先改 `vendor/skill-garden` 源，再通过 `npm run sync` 或 `scripts/sync-enhancements.mjs` 同步 `enhancements/`。
- 研究记录见 `research/local-findings.md`。

## Assumptions

- 优化对象是 Trellis 0.6 的 `trellis-push` skill 语义和提示结构，而不是新增一个完整 CLI 子命令。
- 这次优化不放宽提交安全门禁，不引入 force push，不自动处理 merge 冲突。
- 若后续选择落地实现，需要同步 `.agents`、`.claude`、`vendor/skill-garden` 源和 `enhancements` 快照，避免后续 `update/sync` 漂移。

## Requirements

- 保留 `trellis-push` 作为 Phase 3.4 代码提交/推送的唯一入口。
- 在提交前一次性展示清晰的 commit 计划：具体文件列表、是否 AI 本轮编辑、是否未识别 dirty 文件、草拟 commit message。
- 保留用户确认后才暂存、提交、推送的安全门禁。
- 明确 commit-only、默认 push、push 后可选 merge、只做快照同步等语义模式，减少自然语言歧义。
- 将 `last_push_snapshot` 进度草案纳入执行前的统一确认；执行成功后自动补齐 `pushed_commits`、`snapshot_at` 等运行后字段。
- 父仓 bookkeeping commit/push 仍保持清晰边界：只提交已确认的目标 `task.json`，除非出现额外 dirty 文件才二次询问。
- 多仓库场景下应能清楚报告每个 package 的分支、commit、push/merge 状态。
- 实现范围限定为方案 A：重构现有 skill 文档，收敛确认流，不新增脚本或 CLI 命令。
- 进入实现后，需要配套更新相关 skill 源和发布快照，并执行项目约定的校验。

## Candidate Directions

### 方案 A：文档级重构与确认流收敛（推荐起点）

- 将现有长步骤整理成更明确的阶段：预检、提交计划、一次确认、执行、可选 merge、快照、结果。
- 把“文件列表 + commit message + snapshot 进度草案”的确认门禁前置成标准格式，减少逐步执行时遗漏。
- 优点：改动小，直接提升 AI 执行一致性；不改变架构。
- 代价：仍然依赖 AI 按 skill 文档执行，不能提供脚本级原子性。

### 方案 B：拆出可复用脚本做预检/计划生成

- 保留 skill 负责交互和最终执行，但新增脚本读取配置、收集 git 状态、生成结构化计划。
- 优点：减少 AI 手写 shell 的差异，计划结果更稳定。
- 代价：新增代码和测试成本，需要设计脚本输出 schema。

### 方案 C：完整命令化 trellis-push

- 将 commit/push/merge/snapshot 尽量转为可执行 CLI，由 skill 只负责解释和确认。
- 优点：一致性最高，可测试性最好。
- 代价：范围大，涉及交互、git 异常处理、跨仓状态恢复，容易超出当前优化目标。

## Decision (ADR-lite)

**Context**：`trellis-push` 当前已经覆盖完整提交/推送/合并/快照流程，但文档步骤较长，确认点分散，容易让 AI 在执行时遗漏“具体文件 + commit message + snapshot 进度草案”的统一确认门禁。

**Decision**：MVP 选择方案 A：文档级重构与确认流收敛。先重写 Trellis 0.6 的 `trellis-push` skill 结构，形成固定阶段和统一计划格式。snapshot 的语义内容在执行前一并确认，实际 commit hash 和时间戳在执行成功后补齐。

**Consequences**：改动小、风险低、能快速提升执行一致性；仍依赖 AI 按 skill 文档执行，不提供脚本级原子性。脚本化预检和完整命令化保留为后续任务。

## Open Questions

- 无阻塞问题；等待用户确认规划后进入 `task.py start`。

## Acceptance Criteria

- [ ] PRD 明确 `trellis-push` 优化目标、约束、候选方案和 MVP 范围。
- [ ] 若进入实现，`trellis-push` 的确认流程能一次性展示具体暂存文件和草拟 commit message。
- [ ] 若进入实现，统一确认内容包含 snapshot 进度草案，并说明 `pushed_commits`、`snapshot_at` 等字段执行后补齐。
- [ ] 若进入实现，commit-only、push、merge、snapshot、父仓 bookkeeping 的边界在文档或工具输出中清晰可辨。
- [ ] 若进入实现，安全规则保持不退化：不使用 `git add -A` / `git add .`，不未经确认提交，不 force push，不静默处理 merge 冲突。
- [ ] 若进入实现，skill-garden 源、`.agents` / `.claude` 当前副本、`enhancements` 快照保持一致。
- [ ] 若进入实现，不新增 `trellis-push` 脚本或 CLI 命令。

## Definition of Done (team quality bar)

- 规划产物齐全；复杂实现前补 `design.md` 和 `implement.md`。
- 相关文件更新后执行语法/快照一致性校验。
- 行为变更写入必要的 spec 或研究记录。
- 最终提交仍走 `trellis-push`，不绕过 Phase 3.4 门禁。

## Out of Scope (explicit)

- 不改变 Trellis 上游 npm 包源码，除非后续明确转为上游贡献任务。
- 不自动 force push。
- 不自动解决 merge 冲突。
- 不取消用户对暂存文件和 commit message 的确认权。
- 不新增预检脚本或完整 CLI 化实现；这些作为后续优化方向。

## Research References

- `research/local-findings.md` — 本地架构、同步源、现有 `trellis-push` 行为与约束梳理。
