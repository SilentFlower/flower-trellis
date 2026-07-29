# 设计

## 总体方案

在现有文件级知识发现之后增加一个确定性的“章节加载规划”阶段：

```text
查询
  -> 文件级匹配与置信度
  -> Markdown 章节解析与章节评分
  -> full | sections | outline 加载计划
  -> AI 按计划读取，必要时逐步扩展
```

文件级候选仍决定“哪些 spec 相关”，章节阶段只决定“相关文件应读取多少”。两层职责分离，避免章节算法改变现有 top 3 文件召回语义。

## 数据模型

### `Section`

内部章节对象保存：

- `heading`：当前标题文本。
- `heading_path`：父级到当前标题的路径。
- `routing_heading`：用于章节评分的标题路径；存在 H2/H3 时排除文档 H1，避免文档标题让所有子章节自动相关。
- `level`：H1-H3 层级。
- `start_line` / `end_line`：原文件 1-based 行号。
- `text`：用于计算完整章节范围字节数的原始文本。
- `sample_text`：从标题下一行到下一个任意标题前的直接正文样本，不包含当前标题或子章节正文。

章节解析必须跳过 fenced code block 中的 ATX 标题。frontmatter 解析保持现有兼容能力，但章节行号必须以原文件为基准，不能以去除 frontmatter 后的正文重新编号。

### `SectionMatch`

对外章节结果保存：

- `heading`
- `start_line`
- `end_line`
- `score`
- `confidence`
- `estimated_bytes`

### `Candidate`

保留现有字段，并新增：

- `load_strategy: full | sections | outline`
- `sections: list[SectionMatch]`

现有 frontmatter `load` 字段继续原样输出，不能复用为 `load_strategy`，避免破坏已有文档语义。

## Markdown 章节解析

1. 按原文件逐行扫描，识别 ``` / ~~~ fence 的进入与退出。
2. 仅在 fence 外识别 H1-H3 ATX 标题。
3. 用标题层级栈生成 `heading_path`。
4. 每个章节从自身标题开始，到下一个同级或更高级标题前结束。
5. 长文档优先使用 H2/H3；若只有 H1，则 H1 可作为章节候选。

父章节范围可能包含子章节，因此最终选择时必须去除重叠。父子同时命中时，优先保留证据更强、层级更深且范围更小的章节。

## 匹配模型

### 文件级匹配

保持现有路径、完整标题、index 描述、frontmatter trigger 和正文证据的权重与置信度规则。为覆盖长文档后半部分，同时维持已有锚点候选的排序，正文证据来源调整为：

- 已有 path / 标题 / index / trigger 锚点的候选继续使用当前文件前缀样本，避免破坏已有置信度与排序。
- 对每个章节独立采样开头最多 `MAX_SECTION_BODY_CHARS` 字符。
- 没有文件锚点的正文候选只采用“单个最佳章节样本”的证据，不合并多个章节的零散弱词。
- `Tests Required`、验证矩阵和 Good/Bad 示例等章节正文不参与路由，避免规范中的负例反向召回文档；其标题仍可参与明确查询。

这样可以发现文档后半部分的局部契约，同时避免整篇全文 token 集合放大误报。

### 章节级匹配

- 标题路径命中非弱词是强锚点。
- 同一章节正文样本命中多个非弱词可形成中置信候选。
- path / index 只用于文件级召回，不能单独制造章节命中。
- 排序按置信度、分数、标题层级、范围大小和起始行稳定排序。

## 加载策略

常量初始值：

- `FULL_FILE_MAX_BYTES = 12 * 1024`
- `MAX_SECTION_LOAD_BYTES = 12 * 1024`
- `MAX_SELECTED_SECTIONS = 2`
- `MAX_SECTION_BODY_CHARS = 4000`

决策顺序：

1. 文件 UTF-8 字节数不超过 `FULL_FILE_MAX_BYTES`：`full`。
2. 长文档存在章节候选：按稳定排序选择至多 2 个互不重叠、总字节数不超过预算的章节，得到 `sections`。
3. 没有可靠章节、单个章节超出预算、或所有相关章节都无法装入预算：`outline`。

`outline` 不输出整份标题列表，只提供行动建议，让 AI 通过标题搜索工具检查目录后再读取相关范围。这样 router 输出本身仍保持紧凑。

## Action 文案

`confidence` 决定是否必须读取，`load_strategy` 决定如何读取：

| confidence | strategy | action |
|---|---|---|
| high | full | `read full file before acting` |
| high | sections | `read matched sections before acting; expand only if needed` |
| high | outline | `inspect headings and read relevant sections before acting` |
| medium | full | `read full file if clearly relevant` |
| medium | sections | `read matched sections if clearly relevant` |
| medium | outline | `inspect headings if clearly relevant` |

workflow owner 只描述如何消费 `load_strategy`，具体阈值、字段和错误退化由 helper 与本项目 spec 负责，避免扩大高频 prompt。

## 输出兼容

- CLI 参数和默认 `--limit 3` 不变。
- JSON 现有字段和值类型不变；新增字段允许旧消费者忽略。
- Markdown 保留原候选结构，在 `confidence` 后增加 `load_strategy`，仅 `sections` 时追加紧凑的章节行。
- 无匹配、无 `.trellis/`、文件读取失败仍返回现有非阻断提示和退出码 0。

## 分发与所有权

源文件：

- `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/intent-routing/request-triage/content.md`

生成或同步目标：

- `enhancements/0.6/scripts/spec_router.py`
- `enhancements/0.6/overrides/**`
- `vendor/skill-garden/compiled-targets/0.6.5/**`
- `.trellis/scripts/spec_router.py`
- `.trellis/workflow.md`

项目规范更新位于 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。workflow-state 和 `trellis-before-dev` 只保留 owner 指针，不增加章节策略全文。

## 风险与回退

- 章节解析误认代码示例标题：通过 fence 状态机和单元测试阻断。
- 中文 n-gram 在章节正文中放大误报：正文证据按单章节聚合，维持现有弱词和最低命中阈值。
- 章节范围过大仍消耗上下文：超预算直接退化为 `outline`，不自动全文读取。
- 旧消费者依赖现有 JSON：只新增可选字段，不删除或改名。
- workflow 文案增长：只替换 Request Triage 原有一句读取策略，并运行 strict context budget；不提高阈值。
- 新章节模型导致正例漏检：文件级召回保持原模型，必要时只回退章节选择为 `outline`，不回退文件候选。
