# 新增 trellis-visualize 并替换 draw-uml - Design

## Architecture Boundary

本任务只修改 skill-garden 0.6 强化包及其发布快照，不修改 Trellis upstream，也不修改 skill-garden `old` / `0.5` 变体。

源头文件以 `vendor/skill-garden/.trellis/0.6/` 为准：

- `.agents/skills/trellis-visualize/SKILL.md`
- `.claude/skills/trellis-visualize/SKILL.md`
- 删除 `.agents/skills/trellis-draw-uml/`
- 删除 `.claude/skills/trellis-draw-uml/`

发布快照由 `npm run sync` 生成：

- `enhancements/0.6/.agents/skills/trellis-visualize/SKILL.md`
- `enhancements/0.6/.claude/skills/trellis-visualize/SKILL.md`
- `enhancements/MANIFEST.json`

当前项目已安装副本需要手动同步 0.6 源：

- `.agents/skills/trellis-visualize/SKILL.md`
- `.claude/skills/trellis-visualize/SKILL.md`

## Skill Model

`trellis-visualize` 是一个通用可视化技能，不再以 UML 活动图为中心。它接收模糊描述后先建立图模型，再生成图解产物。

图模型应包含：

- 图类型：架构图、流程图、逻辑图、状态图。
- 主体：角色、系统、组件、服务、外部依赖。
- 关系：调用、依赖、流转、触发、判断、异常、回滚。
- 约束：已确认事实、显式假设、待确认问题。
- 产物：HTML/SVG 主文件、可选 PNG 截图、说明卡片。

## Output Contract

默认输出目录为 `doc/visualize/`，避免继续绑定 `doc/uml/`。

默认产物：

- `doc/visualize/<slug>.html`：主产物，自包含 HTML + inline SVG。
- `doc/visualize/<slug>.png`：需要在对话中展示时生成。

可选辅助产物：

- `doc/visualize/<slug>.md`：仅当用户需要图模型记录或 Mermaid 兼容源码时生成。

不再要求 Mermaid 是主产物。Mermaid 可以作为备选或快速草图，但最终设计范式以 `architecture-diagram` 的 HTML/SVG 单文件为准。

## Visual Design System

新 skill 借鉴 `architecture-diagram`，但要从技术架构扩展到业务流程和逻辑解释。

语义类别：

- 外部参与者 / 外部系统。
- 人工动作。
- 系统动作。
- 服务 / 组件。
- 数据 / 存储。
- 判定节点。
- 异常 / 拒绝 / 超时。
- 成功终态 / 失败终态。

图形规则：

- 节点使用明确的语义颜色和边框，不靠单一颜色区分全部内容。
- 连线先绘制，节点后绘制，避免箭头穿透半透明节点。
- 异常路径使用虚线或高风险色。
- 并行 / 异步关系必须标注，不与普通顺序流混淆。
- 图例放在主图边界外或不遮挡的位置。
- 图下方保留说明卡片：关键节点、关键判定、异常路径、待确认项。

## Compatibility

旧触发词必须迁移到新 skill 的 description：

- 画活动图
- 业务流程图
- 梳理流程
- draw UML

新增触发词：

- 画架构图
- 系统图
- 流程图
- 解释逻辑
- 状态流转
- diagram
- visualize

## Rollout

1. 在 `vendor/skill-garden/.trellis/0.6` 新增 `trellis-visualize` 并删除 `trellis-draw-uml`。
2. 更新 `vendor/skill-garden/README.md` 的 0.6 技能清单。
3. 运行 `npm run sync` 生成 `enhancements/0.6` 和 `enhancements/MANIFEST.json`。
4. 同步当前项目 `.agents` / `.claude` 副本。
5. 验证 0.6 源、快照、当前副本一致；确认 `old` / `0.5` 未被修改。

## Upgrade Cleanup Behavior

`flower-trellis` 的全量增强叠加会读取目标项目 `.trellis/.flower-manifest.json`，用上次记录的 `paths` 与本次 `copySkills` 生成的 `newPaths` 做差集。旧 `trellis-draw-uml` 从 0.6 快照移除后，不会出现在新的 `newPaths` 中；如果目标项目上次由 flower-trellis 全量安装 / 更新并记录了旧路径，本次 `flower-trellis update` 或 `flower-trellis update --enhance-only` 会把旧目录作为 stale path 删除。

不会自动清理的场景：

- 用户使用 `--skills` 精细安装；该模式不维护 manifest，也不做 stale path 清理。
- 用户使用 `--no-enhance`；强化包叠加完全跳过。
- 目标项目没有 `.trellis/.flower-manifest.json`，例如旧能力不是由 flower-trellis 全量铺设，或 manifest 被删 / 损坏。
- 目标项目存在用户手工复制的同名目录但没有被 manifest 记录；清理逻辑只删 flower-trellis 自己铺过的路径，避免误删用户文件。

## Risk And Mitigation

- 风险：删除 `trellis-draw-uml` 后旧触发词失效。
  缓解：把旧触发词写入 `trellis-visualize` frontmatter description 和正文触发说明。
- 风险：只改快照导致下次 sync 覆盖。
  缓解：按规范先改 `vendor/skill-garden/.trellis/0.6`，再运行 `npm run sync`。
- 风险：误删 `old` / `0.5` 变体。
  缓解：实施和检查命令显式限定 0.6，并增加 `git diff -- vendor/skill-garden/.trellis/old vendor/skill-garden/.trellis/0.5 enhancements/old enhancements/0.5` 检查。
- 风险：项目升级后旧 `trellis-draw-uml` 没有被删除。
  缓解：依赖现有全量叠加 manifest 清理机制；在验收中加入含旧 manifest 的临时目标项目验证，并说明 `--skills` / `--no-enhance` / 无 manifest 的限制。
- 风险：`architecture-diagram/` 未跟踪目录来源不清。
  缓解：本任务把它作为参考素材；是否纳入仓库由实现阶段根据产物需要单独判断。
