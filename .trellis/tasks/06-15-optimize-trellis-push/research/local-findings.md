# trellis-push 本地调研

## 调研范围

- `.agents/skills/trellis-push/SKILL.md`
- `.claude/skills/trellis-push/SKILL.md`
- `vendor/skill-garden/.trellis/0.6/.../trellis-push/SKILL.md`
- `enhancements/0.6/.../trellis-push/SKILL.md`
- `.trellis/workflow.md`
- `.trellis/config.yaml`
- `scripts/sync-enhancements.mjs`
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`

## 事实

- 当前 `trellis-push` 是 skill 文档，不是独立可执行命令。
- `.agents` 与 `.claude` 两份当前内容一致。
- 当前项目内 `trellis-push` 与 `vendor/skill-garden` 0.6 源、`enhancements` 0.6 快照一致。
- `scripts/sync-enhancements.mjs` 的同步方向是 `vendor/skill-garden/.trellis` 到 `enhancements/`，最终用户使用的是随包发布快照。
- `.trellis/workflow.md` 中有高优先级约束：Phase 3.4 的代码 commit/push 必须走 `trellis-push`，确认必须展示具体文件列表和 commit message，确认前不能暂存或提交。

## 现有流程风险点

- `trellis-push` 文档较长，提交、push、merge、snapshot、父仓 commit 混在一个长流程里，执行时容易遗漏某个确认边界。
- Step 2.2 暂存确认和 Step 2.3 commit message 确认分散，和 workflow 的“一次展示文件列表 + commit message”门禁存在表述不完全一致。
- Step 3 的 task snapshot 会引入父仓 task.json 变更，并要求额外 commit/push 父仓。snapshot 的语义内容适合纳入执行前统一确认，但父仓 bookkeeping 执行仍需保持清晰边界。
- 多仓库场景中，当前文档说“逐仓库处理”，但缺少一个统一的执行前计划表，用户很难一次性看到所有仓库会发生什么。

## 优化切入点

1. 先做 skill 文档级重构：把长流程整理成固定阶段和统一计划格式。
2. 再考虑脚本化预检：生成结构化 plan，减少 AI 手写命令差异。
3. 最后才考虑完整命令化：范围最大，但可测试性最好。

## 建议

MVP 建议从“文档级重构与确认流收敛”开始：风险小，能直接解决最明显的一致性问题。统一确认应包含 snapshot 进度草案，执行后再补齐实际 commit hash 和时间戳；后续如果仍频繁执行出错，再把预检/计划生成脚本化。
