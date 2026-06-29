# Design

## Architecture

本任务采用“skill-garden 分发通用能力，目标项目 spec 提供具体知识”的结构：

```text
vendor/skill-garden/.trellis/0.6/
  scripts/spec_router.py                # 通用项目知识发现器源
  overrides/workflow.md                 # 高频 hub 规则
  overrides/workflow-states/*.md        # per-turn 短提示
        │
        │ npm run sync
        ▼
enhancements/0.6/
  scripts/spec_router.py
  overrides/...
        │
        │ flower-trellis init/update
        ▼
目标项目
  .trellis/scripts/spec_router.py
  .trellis/workflow.md 中的 skill-garden hub/state sentinel
  .trellis/spec/**/*.md                 # 项目私有 SOP / 规范 / 经验 / guides
```

## `spec_router.py`

### 输入

第一版只要求位置参数：

```bash
python3 ./.trellis/scripts/spec_router.py "<short query describing the intended action>"
```

脚本运行目录可为项目根，也可以从子目录启动；它应向上查找 `.trellis/` 作为项目根。

### 扫描范围

- 默认扫描 `.trellis/spec/**/*.md`，其中 `.trellis/spec/guides/**/*.md` 是共享 thinking guides 层，必须作为一等候选参与匹配。
- 输出中保留 guides 的真实路径，不把 guides 合并或改写成 package layer。
- 忽略隐藏目录、`.trellis/tasks`、`.trellis/workspace` 等非 spec 内容。
- 文件读取失败时跳过该文件，并在 `--verbose`（如实现）或默认摘要中保持非阻断。

### 元数据

支持简单 frontmatter：

```yaml
---
kind: sop
triggers:
  - release
  - 发版
  - npm run release
load: before_action
priority: high
---
```

第一版只需要支持：

- `key: value`
- `key:` 后接 `- item` 列表
- 不支持复杂 YAML 嵌套、引用、锚点或多行字符串

没有 frontmatter 的 Markdown 走退化检索：路径、文件名、H1/H2 标题、正文前若干字符。

### 匹配与排序

采用确定性轻量打分，不引入第三方依赖：

- trigger 精确包含：高分。
- 查询 token 命中文件路径 / 文件名：中高分。
- 查询 token 命中标题：中分。
- 查询 token 命中正文片段：低分。
- `kind: sop` 或 `load: before_action` 可轻微加权。
- `priority: high` 可加权。

输出 top 5 即可，避免把所有 spec 都塞给模型。

### 输出

默认输出给 AI 读取的 Markdown，示例：

```md
## Relevant Project Knowledge

- .trellis/spec/flower-trellis/cli/release-and-publishing.md
  kind: sop
  score: 12
  reason: matched triggers: release, beta; matched path token: publishing
  action: read before acting
```

无匹配：

```md
## Relevant Project Knowledge

No relevant project SOP/spec matched. Continue with the normal workflow.
```

## Workflow 覆写

长规则只放在 `overrides/workflow.md` 的 hub 中，状态块只放一句短提示。这样符合现有 skill-garden 模式：hub 是事实源，workflow-state 是高频 breadcrumb。

建议 hub 小节名：

```md
#### Project Knowledge Discovery
```

状态块短句建议：

```md
Before procedural or high-impact actions, run `.trellis/scripts/spec_router.py`
with a short query describing the intended action and read any matched SOP/spec
before acting.
```

## 安装 / 升级影响

`scripts/sync-enhancements.mjs` 已递归同步 `scripts/`，因此新增源脚本后会自然进入快照。

`copy-scripts.js` 已复制变体 `scripts/` 下的直接文件。若 `--skills` 精细安装需要脚本，需给 `spec_router` 增加别名，例如：

- `spec-router`
- `project-knowledge`
- `knowledge-router`
- `workflow-enhancement`

全装路径不需要别名也能铺设。

## 风险与边界

- 过度提示风险：workflow 文案必须说“procedural or high-impact”，而不是把所有操作都强制检索。
- 漏检风险：第一版靠轻量规则；SOP 可通过 frontmatter triggers 主动提高命中率。
- 上下文膨胀风险：脚本只返回路径和原因，不返回完整 SOP 正文。
- 升级漂移风险：必须先改 `vendor/skill-garden/.trellis/0.6`，再 `npm run sync`，再同步本仓 dogfood 副本。

## 兼容性

- Python 使用标准库，兼容目标项目 `.trellis/scripts` 运行环境。
- 不依赖 Codex / Claude hook，所有平台只要看到 workflow-state 提示即可手动调用。
- 不改变 Trellis 上游核心文件，不影响没有 `.trellis/spec` 的项目。
