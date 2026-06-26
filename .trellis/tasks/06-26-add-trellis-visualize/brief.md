# Brief — 新增 trellis-visualize 并替换 draw-uml

## Goal

- 删除 skill-garden 0.6 中旧的 `trellis-draw-uml` 独立 UML 能力，新增 `trellis-visualize`，用 `architecture-diagram` 的 HTML/SVG 设计范式统一支持架构、流程、业务规则和复杂逻辑解释。

## Scope

- 只覆盖 Trellis 0.6：修改 `vendor/skill-garden/.trellis/0.6` 源、同步 `enhancements/0.6` 快照，并同步当前项目 `.agents` / `.claude` 已安装副本。
- 新增 `trellis-visualize` 双副本：`.agents/skills/trellis-visualize/SKILL.md` 与 `.claude/skills/trellis-visualize/SKILL.md`。
- 删除 0.6 的 `trellis-draw-uml` 双副本。
- 更新 `vendor/skill-garden/README.md` 的 Trellis 0.6 技能清单。
- 新 skill 必须兼容旧触发词（画活动图、业务流程图、梳理流程、draw UML），并覆盖新触发词（画架构图、系统图、解释逻辑、流程图、diagram、visualize）。
- 输出契约默认使用 `doc/visualize/<slug>.html` 作为自包含 HTML + inline SVG 主产物，必要时附 PNG 截图展示。

## Non-Goals

- 不修改 `vendor/skill-garden/.trellis/old` / `enhancements/old` 中的 `draw-uml` command / skill。
- 不修改 `vendor/skill-garden/.trellis/0.5` / `enhancements/0.5` 中的 `trellis-draw-uml` skill。
- 不修改 Trellis upstream。
- 不要求 Mermaid 成为主产物；Mermaid 仅可作为备选或快速草图。

## Key Context

- 源头必须是 `vendor/skill-garden/.trellis/0.6/`，不能只改 `enhancements/0.6` 或当前项目副本；改源后运行 `npm run sync`。
- `flower-trellis update` / `update --enhance-only` 的全量叠加会通过 `.trellis/.flower-manifest.json` 清理上次由 flower-trellis 铺设、本次快照已不存在的 stale paths；因此旧 `trellis-draw-uml` 在有 manifest 的正常升级项目里应被删除。
- `--skills` 精细安装、`--no-enhance`、缺少或损坏 `.trellis/.flower-manifest.json` 的项目不会自动依赖 manifest 删除旧 `trellis-draw-uml`。
- `architecture-diagram/` 当前是未跟踪参考素材，主要用于提取设计系统：语义色板、组件规则、连线规则、版式约束、HTML/SVG 单文件和说明卡片。
- `trellis-visualize` 应先建立可复核图模型，再生成图解；信息不足时先澄清，不得虚构角色、系统、字段、规则、分支或异常路径。
- 验证必须确认 0.6 源、快照、当前副本一致，并确认 `old` / `0.5` 未被修改。

## Acceptance

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-visualize/SKILL.md` 与 `.claude/skills/trellis-visualize/SKILL.md` 存在且一致。
- `vendor/skill-garden/.trellis/0.6`、`enhancements/0.6`、当前项目 `.agents` / `.claude` 不再包含 0.6 的 `trellis-draw-uml` 入口。
- `enhancements/0.6` 已由 `npm run sync` 从源同步，`enhancements/MANIFEST.json` 更新合理。
- `trellis-visualize` 的 frontmatter 和正文覆盖架构图、流程图、业务逻辑、状态流转和旧 UML 触发词。
- `vendor/skill-garden/README.md` 的 Trellis 0.6 技能清单已更新为 `trellis-visualize`。
- 验证含旧 `.trellis/.flower-manifest.json` 的目标项目在全量增强叠加后会删除旧 `trellis-draw-uml` 并写入新 manifest。
- `diff -u` 验证 0.6 `.agents` / `.claude` 源副本一致，源与 `enhancements/0.6` 快照一致，源与当前项目副本一致。
- `git diff -- vendor/skill-garden/.trellis/old vendor/skill-garden/.trellis/0.5 enhancements/old enhancements/0.5` 无非预期改动。

## Next Step

- 用户确认 brief 后运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/06-26-add-trellis-visualize`，进入 in_progress；随后按 workflow 进入 `trellis-route(implement)`，不直接编辑。
