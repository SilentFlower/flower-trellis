# 优化 trellis-release 与 finish-work 上线核对规则

## Goal

优化 skill-garden 中 `trellis-release` 与 `trellis-finish-work` 的上线事项规则，让 AI 不只是按已有 `release.md` 做机械汇总，而是在正式上线单生成和 finish-work 归档注入时都明确执行证据核对，降低任务文档、实现代码、提交记录和上下文压缩之间发生漂移后仍产出错误上线文档的风险。

同时为 `.trellis/releases/` 下的版本 / 批次上线单文件名定义稳定格式，方便按时间、版本或批次查找。

## Confirmed Facts

- `trellis-release` 源文件同时存在于 `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md` 与 `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-release/SKILL.md`，当前两份内容一致。
- `trellis-release` 当前规则主要读取任务 `task.json`、`prd.md`、`release.md` 并汇总，缺少对 `design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`、代码 diff、提交记录等证据的强制交叉核对步骤。
- `trellis-release` 当前输出路径是 `.trellis/releases/<release-name>.md`，用户未给名称时使用类似 `release-2026-06-17` 的日期名；命名规则不够明确，不利于后续稳定检索。
- `finish-work` 的 release 注入源文件位于 `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md`，会注入到本地 `trellis-finish-work` skill / command。
- `finish-work` 当前注入块会读取任务文件、提交和 dirty path 分类来推断是否需要 `<task>/release.md`，但没有显式强调“上下文压缩后必须重新从文件和 git 证据核对，不能依赖记忆”。
- 本仓库约定：改 0.6 强化 skill / workflow 覆盖时，先改 `vendor/skill-garden/.trellis/0.6/` 源，再运行 `npm run sync` 生成 `enhancements/0.6/` 快照，必要时同步当前项目 `.agents` / `.claude` 已安装副本。

## Requirements

- `trellis-release` 必须从“汇总已有 `release.md`”升级为“生成前核对上线风险并汇总”：
  - 读取每个纳入任务的 `task.json`、`prd.md`、`design.md`（如有）、`implement.md`（如有）、`implement.jsonl`、`check.jsonl`、`release.md`（如有）。
  - 对照任务相关文件、`git diff` / `git show` / 最近提交记录等本地证据，查找 SQL、配置、批处理 / 部署脚本 / 数据修复、外部系统 / 依赖平台、回滚、上线后验证等事项。
  - 对已有 `release.md` 的内容执行漂移核对：确认它是否覆盖任务实现范围；发现缺失、冲突或证据不足时，在上线单中明确标记“需人工复核”，不能静默相信旧文档。
  - 对缺失 `release.md` 的任务，不自动补写单任务 `release.md`，但必须在批次上线单中列出缺失并记录核对结论。
- `trellis-release` 必须定义 `.trellis/releases/` 文件名格式：
  - 用户显式给出文件名时仍尊重用户输入，但要清理成安全文件名。
  - 用户未给出时使用 `YYYY-MM-DD-<release-slug>.md`，例如 `2026-06-25-v0.3.1-beta.1.md` 或 `2026-06-25-h0-relay-batch.md`。
  - 如果缺少版本或批次名，退化为 `YYYY-MM-DD-release.md`。
  - 如果目标文件已存在，追加 `-2`、`-3` 等数字后缀，避免覆盖已有上线单。
- `trellis-release` 生成的上线单模板必须包含“核对摘要 / 风险标记”类小节，用于记录核对了哪些任务、哪些证据、哪些内容存在漂移或需要人工复核。
- `finish-work` 注入块必须明确：
  - 即使上下文压缩或会话恢复，也要重新读取任务文件和 git 证据，不得依赖对之前上下文的记忆。
  - 已存在 `<task>/release.md` 时要核对是否与当前任务实现 / 提交一致；发现明显漂移时要更新或标记 `Needs human review`。
  - 无法高置信判断时宁可写入需人工复核的 `release.md`，不要假装无上线事项。
- 修改必须覆盖 skill-garden 源、发布快照和当前项目已安装副本，避免平台之间行为分叉。
- 本任务只改 AI skill / override 规则文本，不执行真实上线、不提交代码、不推送代码、不改变 Trellis 原生命令实现。

## Acceptance Criteria

- [ ] `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-release/SKILL.md` 与 `.claude` 对应文件都包含明确的“交叉核对 / 漂移检查”步骤。
- [ ] `trellis-release` 的规则明确默认文件名格式为 `YYYY-MM-DD-<release-slug>.md`，包含示例、缺省 slug 和重名冲突处理。
- [ ] `trellis-release` 的上线单模板包含核对摘要、漂移 / 风险标记、未记录上线事项任务。
- [ ] `vendor/skill-garden/.trellis/0.6/overrides/skills/trellis-finish-work.md` 明确上下文压缩后也必须重新读文件和 git 证据核对，不能依赖记忆。
- [ ] 运行 `npm run sync` 后，`enhancements/0.6/` 中的对应 skill / override 与源文件同步。
- [ ] 当前项目 `.agents` / `.claude` 已安装副本同步到同一规则，后续当前会话调用对应 skill 时能使用新规则。
- [ ] 不修改与本任务无关的 `ftl -v` 排版任务文件。

## Out of Scope

- 不设计或执行真实上线流程。
- 不自动运行 SQL、脚本、部署、外部平台操作。
- 不改变 `task.py`、`finish-work` 原生归档命令或 Trellis CLI 运行时代码。
- 不为历史任务批量生成或修复 `release.md`。

## Notes

- 这次属于 skill 指令行为优化，主要风险不是代码逻辑，而是指令约束不够硬导致 AI 继续依赖旧文档或压缩前记忆。
- 已确认默认 release 文件名采用 `YYYY-MM-DD-<release-slug>.md`。
