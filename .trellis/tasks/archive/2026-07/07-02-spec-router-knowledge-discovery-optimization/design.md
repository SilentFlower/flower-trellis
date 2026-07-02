# 设计

## 总体方案

本任务把 `spec_router.py` 从“泛关键词路由器”调整为“项目知识发现器”。它仍保持无依赖、确定性、轻量输出，但匹配模型从简单子串命中改成“强锚点 + 弱证据 + 置信度”。

核心设计：

1. workflow 只规定何时做知识发现，不把每条命令都变成检索动作。
2. `spec_router.py` 只扫描 `.trellis/spec/**/*.md`，不扫描任务、工作区或代码目录。
3. 文档自然结构是主索引：路径、文件名、H1-H3、`index.md` 链接描述、正文前缀。
4. `frontmatter` 解析保留为兼容能力，但不是主设计，不新增、不推广、不依赖 `triggers`。
5. 输出增加置信度，高置信要求读取，中置信只建议按相关性读取。

## 触发文案

源头文件：

- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md`

同步目标：

- `enhancements/0.6/overrides/**`
- `.trellis/workflow.md`

长文案应表达：

```md
Before choosing an approach for non-trivial project work, run project knowledge
discovery when project-local SOPs, package conventions, workflow rules,
config/state contracts, release/publish/deploy steps, git history actions,
data changes, cross-layer design, generated artifacts, install/sync pipelines,
or destructive operations may affect the correct approach.

Do not run it for pure Q&A, simple read-only inspection, opening local tools,
or trivial edits unless the request mentions project conventions.
```

状态块保留短句，强调“决策边界触发”，避免每条 shell 命令前重复运行。

## 匹配模型

### Token 化

当前实现用 `token in text` 做子串判断，容易把 `to` 命中 `directory-structure`，或让 `flow` 命中很多上下文。本轮改为：

- 查询、路径、标题、index 描述、正文样本都使用统一 `normalize_tokens()`。
- 匹配时使用 token set 交集。
- 路径 token 需要把 `/`、`-`、`_`、`.` 作为分隔语义处理，确保 `release-and-publishing.md` 能产生 `release`、`publishing` 等 token。

### 弱词

将原 `BODY_WEAK_TOKENS` 扩展为通用弱词集合，至少覆盖：

- 英文虚词：`to`、`and`、`or`、`of`、`in`、`for`、`with`、`from`、`the`
- 操作泛词：`run`、`change`、`update`、`command`、`commands`、`file`、`files`
- 容易误召回词：`flow`、`data`、`commit`、`changes`
- 现有项目知识路由泛词：`project`、`context`、`read`、`matched`、`spec`、`workflow`

弱词可以出现在 reason 中，但不能独自构成强匹配。

### 强锚点

候选必须满足至少一个强条件：

- 路径命中非弱词 token。
- 标题命中非弱词 token。
- `index.md` 描述命中非弱词 token。
- 正文样本命中多个非弱词 token，且只能给中置信，除非同时有路径 / 标题 / index 证据。
- 兼容性 frontmatter trigger 命中时可参与加分，但不作为新文档推荐路径。

### Index 描述

解析 `.trellis/spec/**/index.md` 时，只把链接到同目录或子目录 Markdown 文件的条目作为路由描述。建议处理 Markdown 表格和普通链接两种形式：

- `[Release & Publishing](./release-and-publishing.md) | 发版流程...`
- `- [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) - ...`

对于被链接的目标文档，将链接文本和同一行文本加入该文档的 `index_description`。最终候选仍指向目标文档，不默认把 `index.md` 作为最高优先候选。

## 输出模型

`Candidate` 增加：

- `confidence: high | medium`
- `action: read before acting | read if clearly relevant`

默认输出：

- 高置信候选：保留，action 为 `read before acting`。
- 中置信候选：可保留在 top N 中，但 action 为 `read if clearly relevant`。
- 低置信候选：默认不输出；如后续需要，可加 `--debug` 展示过滤原因，本轮非必需。

JSON 输出同步增加 `confidence` 字段。

## 分发与同步

实现顺序以源文件为准：

1. 修改 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`。
2. 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 和 workflow-state。
3. 运行 `npm run sync`，同步到 `enhancements/0.6`。
4. 同步 dogfood 副本 `.trellis/scripts/spec_router.py` 和 `.trellis/workflow.md`。

如果 `npm run sync` 不能覆盖 dogfood 副本，需要手动保持 dogfood 与快照一致，并在检查时用 `cmp -s` 验证。

## 风险与取舍

- 不删除 frontmatter 解析，避免破坏已有项目里可能已经写的 `kind` / `load` / `priority` / `triggers`。
- 不继续推广 triggers，避免把 spec 文档变成机器标签维护系统。
- 不引入 BM25 / 向量 / 缓存，保持脚本可以随增强包无依赖分发。
- index 描述解析要保守，解析失败时应退化为原路径 / 标题 / 正文匹配，不阻断流程。
