# Brief — Optimize spec_router section-aware loading

## Goal

- 在保留现有文件级知识发现能力的同时，为命中 spec 生成确定性的章节级加载计划，减少长文档全文读取造成的上下文浪费。

## Scope

- 为候选增加 `load_strategy: full | sections | outline`；保留现有 JSON 字段、CLI 参数、top 3 和 high/medium 语义。
- 按 H1-H3 解析 Markdown，忽略 fenced code block 内伪标题，输出原文件 1-based 章节行号和父子标题路径。
- 小于等于 `12 KiB` 的文档读取全文；长文档最多选择 2 个互不重叠、合计不超过 `12 KiB` 的相关章节；无法安全缩小时先检查目录。
- 按章节分别采样正文，使长文档后半部分可以参与召回，同时禁止把多个章节的零散弱词合并成强证据。
- 只修改 workflow `Request Triage` 的唯一读取策略 owner，不向 workflow-state、SessionStart、brainstorm 或 `trellis-before-dev` 复制完整规则。
- 修改 Skill-Garden canonical 脚本和 workflow Patch，刷新 compiled targets、Flower 快照、本仓 dogfood 副本及项目规范。
- 新增 Python `unittest`，覆盖章节解析、预算策略、兼容输出和历史正负例。

## Non-Goals

- 不在 router 输出中内联章节正文，不修改任务 JSONL 的文件级 schema。
- 不新增 hook 自动读取，不要求 spec 维护新 frontmatter 或机器关键词。
- 不引入向量、BM25、持久缓存、外部索引服务或第三方 Python 依赖。
- 不重新设计知识发现触发范围、文件级 top 3 或现有置信度体系。

## Key Context

- canonical helper：`vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`。
- workflow owner：`vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/intent-routing/request-triage/content.md`。
- 生成目标：`enhancements/0.6/**`、`vendor/skill-garden/compiled-targets/0.6.5/**`、`.trellis/scripts/spec_router.py`、`.trellis/workflow.md`。
- 项目契约：`.trellis/spec/flower-trellis/cli/enhancements-model.md` 与 `ai-context-budget.md`。
- 兼容要求：保留 `file/kind/score/confidence/load/priority/reason/action`；新增 `load_strategy` 和 `sections` 只能作为扩展。
- `frontmatter triggers` 继续仅作兼容，不推广、不新增、不依赖。
- 主要风险是章节范围误判、中文 n-gram 误召回、超预算章节和 workflow 文案增长；分别通过 fence 状态机、单章节证据聚合、`outline` 退化和 strict context budget 控制。
- 当前任务创建前已有未跟踪 `.flower/` 文件，属于用户基线，本任务不修改或回退。

## Acceptance

- 小文档返回 `full`；长文档后半明确命中返回预算内 `sections`；路径/index-only、无可靠章节或章节超预算返回 `outline`。
- 章节行号与原文件一致，frontmatter 不造成偏移，fenced code 内标题被忽略。
- `sections` 至多 2 个、互不重叠、预计总量不超过 `12 KiB`，父子命中优先更具体章节。
- JSON 保留全部旧字段，Markdown 不内联正文，action 同时体现 confidence 和加载策略。
- 历史发版/thinking-guide 正例及轻量操作/泛词负例不回归。
- workflow 最终目标包含加载计划消费规则，state、SessionStart 与 before-dev 不出现重复长规则。
- canonical、快照、dogfood 保持一致；定向 unittest、Python 语法、`npm test`、compiled targets、strict AI context budget 和 `git diff --check` 全部通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-29-spec-router-section-aware-loading`，再进入 `trellis-route(implement)` 执行实现路由。

