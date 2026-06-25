# Implement — 增加任务启动交接摘要

## Checklist

- [x] 读取 Trellis workflow / skill / hook 相关现状：
  - `.trellis/workflow.md`
  - `.agents/skills/`
  - `.claude/skills/`
  - `.codex/hooks/session-start.py`
  - `.claude/hooks/session-start.py`
  - `enhancements/0.6/**`
  - `vendor/skill-garden/.trellis/0.6/**`
- [x] 新增 `trellis-task-brief` skill：
  - `.agents/skills/trellis-task-brief/SKILL.md`
  - `.claude/skills/trellis-task-brief/SKILL.md`
- [x] 定义 `brief.md` 模板、更新算法和校验规则。
- [x] 确保 skill 每次运行都读取最新 `prd.md`、`design.md if present`、`implement.md if present`，并写回更新后的 `brief.md`。
- [x] 确保已有 `brief.md` 不会导致 skill 跳过同步；无法追溯到三件套的旧内容不保留为事实。
- [x] 确保 skill 写回 `brief.md` 后必须在对话中展示 brief 正文，而不是只提示文件路径。
- [x] 确保 `brief.md` 和对话展示不机械截断：start review 展示完整 brief，in_progress 重述可压缩但不能丢失影响实现判断的要点。
- [x] 修改 `.trellis/workflow.md` 的 Phase 1.4、planning state、in_progress state 文案。
- [x] 确保 Phase 1.4 start review 要求展示 `brief.md` 并获得用户确认后才运行 `task.py start`。
- [x] 确保 `in_progress` 进入 implement route 前会在对话中重述 `brief.md`；缺失时提示读取三件套并回补。
- [x] 若 workflow 文案来自 skill-garden / enhancements，同步修改源文件与快照副本。
- [x] 清理 `implement.jsonl` / `check.jsonl` 示例行并写入真实上下文。
- [x] 验证新增 skill 文案不会与 `trellis-brainstorm`、`trellis-continue`、`trellis-route` 触发边界冲突。
- [x] 验证旧任务缺少 `brief.md` 时不会阻断执行，只会提示读取三件套并回补。
- [x] 新增按需 `trellis-diff-brief` skill，用于 push / check / review 前解释实际 diff，不写文件、不接入固定 workflow gate。

## Validation

- [x] 搜索确认 `brief.md` 相关规则在 `.agents` / `.claude` / workflow 文案中一致。
- [x] 对一个 PRD-only 任务人工演练 brief 模板。
- [x] 对一个复杂三件套任务人工演练 brief 模板。
- [x] 修改三件套后再次运行 `trellis-task-brief`，确认 `brief.md` 被最新内容覆盖/修正。
- [x] 在已有 `brief.md` 中加入三件套没有的内容，再运行 skill，确认该内容不会被当作事实保留。
- [x] 运行 `trellis-task-brief` 后，确认对话输出包含 brief 正文而非仅文件路径。
- [x] 模拟 Phase 1.4 review，确认用户能在对话里看到 brief 后再确认 start。
- [x] 模拟 in_progress 任务，确认 implement route 前会展示或重述 brief。
- [x] 确认复杂任务的 brief 不复制三件套大段内容，但保留会影响实现判断的范围、约束、风险和验收条件。
- [x] 确认不修改 `task.py start` 的生命周期语义。
- [x] 运行本项目语法检查：
  ```bash
  node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done
  ```
- [x] 如果修改了 `enhancements/` 或 `vendor/skill-garden`，运行对应 snapshot 同步/检查命令。

## Validation Notes

- `npm run sync` 已运行，`enhancements/0.6` 从 `vendor/skill-garden/.trellis/0.6` 重新生成。
- `diff -u` 已确认新增 `trellis-task-brief` skill、workflow hub、planning/planning-inline/in_progress/in_progress-inline state 在 vendor 源、enhancements 快照和当前 `.agents` / `.claude` 副本一致。
- `node --check src/cli.js && for f in src/lib/*.js src/commands/*.js; do node --check "$f"; done` 通过。
- `node --check src/lib/workflow-inject.js && node --check scripts/sync-enhancements.mjs && bash -n vendor/skill-garden/scripts/install.sh` 通过。
- `/root/.codex/skills/.system/skill-creator/scripts/quick_validate.py` 逐个校验 vendor / enhancements / 当前 `.agents` / `.claude` 的 `trellis-task-brief` skill 目录通过。
- Phase 2.2 检查时补强了 `trellis-task-brief` 的 in_progress 缺失 brief 分支：默认只读三件套并建议回补，只有用户明确要求当场回补并 review 时才写回；同时明确 brief / 对话展示不能机械限长。
- 按 review 反馈压缩了 workflow hub 的 `Task Brief Handoff` 段：hub 只保留 start 前门禁、三件套权威性、实现前重述/缺失回退；同步型更新、冲突处理、展示完整性等细节保留在 `trellis-task-brief` skill 中。
- 按后续讨论新增 `trellis-diff-brief`，并同步到 vendor / enhancements / 当前 `.agents` / `.claude`；`quick_validate.py` 校验通过。
- `node scripts/check-snapshot.mjs` 当前预期失败：该检查要求 `enhancements/` 无未提交改动；本任务正引入并等待提交这些快照改动。

## Risk Notes

- workflow 文案存在本地 `.trellis`、`enhancements/0.6`、`vendor/skill-garden` 多份副本，实施时必须避免只改一处。
- skill 名称必须避开 bundled skills，防止 `trellis update` 覆盖。
- `brief.md` 是交接摘要，不应成为第四件套；skill 文案需要持续强调三件套权威性。
