# 新增 trellis-visualize 并替换 draw-uml

## Goal

删除现有 `trellis-draw-uml` / `draw-uml` 能力，新增 `trellis-visualize`，吸收 `architecture-diagram` 的 HTML/SVG 设计范式，让同一个可视化技能同时支持架构、流程、业务规则和复杂逻辑解释。

## Background

- 用户认为现有 `trellis-draw-uml` 效果不够好，不希望继续维护一个独立 UML 活动图技能。
- `architecture-diagram` 的优势不是只会画架构图，而是有完整的设计系统：适用范围、语义色板、组件规则、连线规则、版式约束、HTML/SVG 单文件产物和说明卡片。
- 新技能名称已确认使用 `trellis-visualize`，避免 `architecture-diagram` 过长，也避免 `trellis-diagram` 语义不够直观。
- 现有 `draw-uml` 分布在 `vendor/skill-garden/.trellis/old`、`0.5`、`0.6`，以及 `enhancements/*` 快照和当前项目 `.agents` / `.claude` 副本。
- 范围决策：本任务只覆盖 Trellis 0.6；`old` / `0.5` 暂不迁移、不删除，保持历史兼容。

## Requirements

- R1: 删除或替换 skill-garden 0.6 中现有 `trellis-draw-uml` 入口，不再把旧 UML-only skill 作为 0.6 独立能力分发。
- R2: 新增 `trellis-visualize` skill，定位为“把架构、流程、业务规则和复杂逻辑转成可复核的可视化图解”。
- R3: `trellis-visualize` 必须兼容旧触发意图，包括“画活动图”、“业务流程图”、“梳理流程”、“draw UML”等。
- R4: `trellis-visualize` 必须覆盖新触发意图，包括“画架构图”、“系统图”、“解释逻辑”、“流程图”、“diagram”、“visualize”等。
- R5: 新 skill 应支持四类图解：架构图（系统、服务、组件、部署、依赖关系）、流程图（角色、触发、主路径、分支、异常、终态）、逻辑图（规则链路、判断条件、因果关系）、状态图（状态流转、事件触发、失败 / 回滚路径）。
- R6: 新 skill 应先把用户输入整理成可复核的图模型，再生成图，避免直接从模糊描述跳到画图。
- R7: 信息不足时必须先澄清关键问题；不得虚构角色、系统、字段、规则、分支或异常路径。
- R8: 输出主产物默认使用 `doc/visualize/<slug>.html`，采用自包含 HTML + inline SVG；必要时附 PNG 截图用于对话展示。
- R9: 新 skill 应继承 `architecture-diagram` 的设计系统思想：语义颜色、节点类型、连线类型、边界 / 分组、图例、说明卡片和离线可打开产物。
- R10: 实现时必须先改 `vendor/skill-garden/.trellis/0.6/` 源，再运行 `npm run sync` 更新 `enhancements/` 快照；不得只改当前项目副本或快照。
- R11: 当前项目已安装副本 `.agents/skills` 和 `.claude/skills` 需要与 0.6 源保持一致。
- R12: `vendor/skill-garden/README.md` 中的技能清单和说明需要从 `trellis-draw-uml` 更新为 `trellis-visualize`。
- R13: 通过 `flower-trellis update` 或 `flower-trellis update --enhance-only` 进行全量强化包叠加时，已由 flower-trellis manifest 记录的旧 `trellis-draw-uml` 路径必须作为过期强化项被清理。
- R14: 明确记录清理限制：`--skills` 精细安装、`--no-enhance`、或缺少 `.trellis/.flower-manifest.json` 的目标项目不会依赖 manifest 自动删除旧 `trellis-draw-uml`。

## Acceptance Criteria

- [x] `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-visualize/SKILL.md` 和 `.claude/skills/trellis-visualize/SKILL.md` 存在，内容一致。
- [x] `vendor/skill-garden/.trellis/0.6` 不再包含 `trellis-draw-uml` skill 目录。
- [x] `enhancements/0.6` 通过 `npm run sync` 从源同步，包含 `trellis-visualize` 且不再包含 `trellis-draw-uml`。
- [x] 当前项目 `.agents/skills/trellis-visualize/SKILL.md` 和 `.claude/skills/trellis-visualize/SKILL.md` 存在，并不再包含旧 `trellis-draw-uml` 副本。
- [x] `trellis-visualize` 的 frontmatter description 明确覆盖架构图、流程图、业务逻辑、状态流转和旧 UML 触发词。
- [x] `trellis-visualize` 正文包含输入澄清、图类型选择、图模型整理、HTML/SVG 输出、PNG 展示、说明卡片、待确认项和迭代规则。
- [x] `vendor/skill-garden/README.md` 的 Trellis 0.6 技能清单已更新为 `trellis-visualize`。
- [x] `rg "trellis-draw-uml|draw-uml" vendor/skill-garden/.trellis/0.6 enhancements/0.6 .agents .claude` 不再命中应删除的旧 0.6 入口或 README 清单。
- [x] `diff -u` 验证 0.6 的 `.agents` / `.claude` 源副本一致，源与 `enhancements/0.6` 快照一致。
- [x] 通过代码检查或临时目标项目验证：当旧 `.trellis/.flower-manifest.json` 含 `.agents/skills/trellis-draw-uml` / `.claude/skills/trellis-draw-uml` 且本次全量叠加的 `newPaths` 不含旧路径时，`applyEnhancements` 会删除旧目录并写入包含 `trellis-visualize` 的新 manifest。
- [x] 规划完成后，复杂任务在 `task.py start` 前补齐 `design.md` 和 `implement.md`。

## Out of Scope

- 不修改 `vendor/skill-garden/.trellis/old` / `enhancements/old` 中的 `draw-uml` command / skill。
- 不修改 `vendor/skill-garden/.trellis/0.5` / `enhancements/0.5` 中的 `trellis-draw-uml` skill。

## Notes

- 本任务涉及 skill-garden 源、随包快照和当前项目已安装副本，是复杂任务；实现前应补齐 `design.md` 和 `implement.md`。
- `architecture-diagram/` 当前是未跟踪目录，应在实现前确认它是参考素材、待纳入仓库，还是只作为临时研究输入。
