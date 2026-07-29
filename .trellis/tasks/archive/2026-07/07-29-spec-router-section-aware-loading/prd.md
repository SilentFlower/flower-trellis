# 优化 spec_router 章节感知加载

## 目标

让 `spec_router.py` 在保持文件级知识发现能力的同时，为命中文档生成确定性的章节级加载计划，减少长 spec 被整份读取造成的上下文浪费，并在无法安全定位章节时保留全文或目录级兜底。

## 背景

- 当前脚本扫描 `.trellis/spec/**/*.md`，默认最多返回 3 个文件候选；输出不包含正文，但高置信候选只有笼统的 `read before acting` 行动建议。
- 当前正文匹配只使用每个文件前 `8000` 个字符，而标题扫描覆盖完整文档。长文档后半部分只有正文证据、没有强标题时可能漏检；命中文件后又缺少章节范围，AI 容易直接读取全文。
- 当前项目已有超过 100 KiB 的单份 spec，例如 `.trellis/spec/flower-trellis/cli/enhancements-model.md`。将这类文件整份放入上下文与“package spec 按需读取”的预算原则冲突。
- 现有项目知识发现契约要求保持零依赖、确定性、保守候选数量，不内联完整 spec 内容；`frontmatter triggers` 只作为兼容能力，不推广、不新增、不依赖。
- 用户已确认默认采用“文件级召回、章节级读取、全文兜底”的方向。
- 历史任务 `.trellis/tasks/archive/2026-07/07-02-spec-router-knowledge-discovery-optimization/` 已建立路径、标题、index 描述、弱词和置信度模型，本任务在该模型上增量扩展，不重做触发边界或引入新的检索体系。

## 需求

### R1. 输出章节感知加载计划

- 保留现有文件级候选排序和默认最多 3 条的限制。
- 每个候选新增 `load_strategy`，固定取值为：
  - `full`：文档足够小，直接读取全文。
  - `sections`：长文档存在可验证、预算内的相关章节，只读取这些章节。
  - `outline`：文档相关但无法生成安全的预算内章节范围，先检查标题目录，再选择章节。
- `sections` 策略必须输出至多 2 个互不重叠的章节，包含标题路径、原文件中的 1-based 起止行、分数、置信度和预计 UTF-8 字节数。
- 现有 JSON 字段 `file`、`kind`、`score`、`confidence`、`load`、`priority`、`reason`、`action` 必须保留；新增字段只能做向后兼容扩展。
- Markdown 输出继续保持紧凑，只输出路径、加载策略和章节范围，不内联章节正文。

### R2. 使用确定性的 Markdown 章节模型

- 按 H1-H3 ATX 标题解析章节，维护父子标题路径并保留原文件行号。
- 忽略 fenced code block 内看起来像标题的文本，避免示例代码污染章节结构。
- H2/H3 是长文档章节加载的首选粒度；仅当文档没有更细层级时才使用 H1。
- 章节范围从标题行开始，到下一个同级或更高级标题前结束。
- 章节匹配复用现有 token 化、弱词过滤和置信度模型，不引入向量、BM25 或第三方 Markdown 解析依赖。
- 为覆盖长文档后半部分，应分别采样各章节开头，而不是只采样整份文档的全局前缀；正文证据必须在同一章节内形成，不能把分散于多个章节的弱命中拼成高置信结果。

### R3. 保守执行上下文预算

- 初始全文阈值使用 UTF-8 字节数 `12 KiB`；不超过阈值的候选使用 `full`。
- 长文档最多选择 2 个非重叠章节，建议加载总量不得超过 `12 KiB`。
- 优先选择更具体、证据更强的子章节；父子章节重叠时不得重复加载。
- 单个相关章节本身超出预算、只有文件路径/index 描述证据、或无法形成可靠章节证据时使用 `outline`，不得退化为无条件全文加载。
- 章节内容引用未加载的定义、文件级不变量或相邻契约时，workflow 应允许 AI 扩展读取相关章节；只有局部读取仍不足时才读取全文。

### R4. 更新唯一读取策略 owner

- 只在 workflow `Request Triage` 的 Project Knowledge Discovery 契约中补充加载计划消费规则。
- 高置信候选继续要求行动前读取，中置信候选继续只在明确相关时读取。
- AI 应遵循 `load_strategy`：`full` 读全文、`sections` 读指定范围、`outline` 先检查标题再读相关章节。
- 不把完整加载策略复制到 workflow-state、`trellis-before-dev`、brainstorm 或 SessionStart，保持现有 owner 和上下文预算边界。

### R5. 保持分发、dogfood 与测试一致

- canonical 源继续位于 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 和对应 workflow Patch。
- 通过 `npm run sync` 生成 `enhancements/0.6/` 快照，并同步本仓 `.trellis/scripts/spec_router.py` dogfood 副本。
- workflow Patch 变化后刷新 Skill-Garden canonical compiled targets，并保持 Patch conflict 与 AI context budget 门禁通过。
- 新增独立 Python `unittest`，直接加载 canonical `spec_router.py`，覆盖章节解析、预算策略、输出兼容和旧正负例。

## 非目标

- 不把命中章节正文直接写入 `spec_router.py` 输出。
- 不修改 `implement.jsonl` / `check.jsonl` 的文件级 schema。
- 不新增 hook 自动执行知识发现或自动读取文件。
- 不要求项目 spec 新增 frontmatter、section ID 或机器维护的关键词。
- 不引入向量数据库、BM25、外部索引服务、持久缓存或第三方 Python 依赖。
- 不调整普通请求的知识发现触发范围，不重新设计文件级置信度模型。

## 验收标准

- [ ] 小于等于 `12 KiB` 的命中文档返回 `load_strategy: full`，且不生成无意义章节列表。
- [ ] 超过阈值且后半部分 H2/H3 明确命中的文档返回 `load_strategy: sections`，章节行号对应原文件且无需读取全文。
- [ ] 章节解析忽略 fenced code block 内的伪标题，并正确生成 H1-H3 标题路径。
- [ ] `sections` 至多包含 2 个互不重叠章节，预计总加载量不超过 `12 KiB`，父子命中优先保留更具体章节。
- [ ] 长文档只有路径/index 描述证据、相关章节超出预算或没有可靠章节证据时返回 `load_strategy: outline`。
- [ ] JSON 保留全部现有字段并新增 `load_strategy` / `sections`；Markdown 不内联正文。
- [ ] `action` 能区分 `full`、`sections`、`outline`，同时保留 high/medium 的读取强度差异。
- [ ] 现有发版、thinking guide 正例仍能召回；历史轻量操作和泛词负例仍保持无匹配或不要求读取无关规范。
- [ ] workflow 的唯一 owner 明确要求遵循加载计划，workflow-state 与 `trellis-before-dev` 不复制完整规则。
- [ ] canonical、`enhancements/0.6` 快照和 `.trellis/scripts/spec_router.py` dogfood 副本一致。
- [ ] Python 语法检查、新增单元测试、`npm test`、compiled targets 检查、strict AI context budget 和 `git diff --check` 全部通过。

