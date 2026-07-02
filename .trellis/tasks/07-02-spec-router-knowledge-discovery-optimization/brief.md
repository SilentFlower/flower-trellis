# Brief — Optimize spec_router knowledge discovery

## Goal

- 优化 `spec_router.py` 和对应 workflow 提示，让 Trellis 在“项目局部知识可能影响做法”的场景中更稳定地发现 SOP / spec / thinking guide，同时避免普通问答、只读查看、本地工具打开和轻量操作被过度检索。

## Scope

- 将 workflow 触发边界从 `procedural or high-impact actions` 调整为“项目局部知识可能影响做法的决策边界触发”，并明确不适用于纯问答、简单只读查看、打开本地工具和轻量文案 / 拼写修改。
- 重构 `spec_router.py` 的匹配模型：路径、标题、index 描述、正文样本统一 token 化，用 token set 匹配替代子串匹配。
- 扩展弱词过滤，降低 `to`、`flow`、`commit`、`command`、`changes` 等泛词导致的误召回。
- 引入“强锚点 + 弱证据 + 置信度”模型，输出 `confidence`，并区分高置信与中置信候选的 action 文案。
- 使用 `.trellis/spec/**/index.md` 的链接文本和邻近描述作为非侵入式路由描述，最终候选仍优先指向具体文档。
- 优先修改 `vendor/skill-garden/.trellis/0.6/` 源文件，通过 `npm run sync` 同步到 `enhancements/0.6/`，再同步本仓 dogfood 副本 `.trellis/scripts/spec_router.py` 和 `.trellis/workflow.md`。

## Non-Goals

- 不为每个 SOP 创建新 Skill。
- 不把项目私有 SOP 内容复制进 skill-garden。
- 不推广 `frontmatter triggers` 作为主要路由机制。
- 不做 hook 自动执行 `spec_router.py`。
- 不引入 BM25、向量数据库、外部索引服务或持久缓存。
- 不修改 Trellis 上游核心脚本，不新增第三方依赖。

## Key Context

- 当前误报来自子串匹配：`.trellis/scripts/spec_router.py:285`、`.trellis/scripts/spec_router.py:290`、`.trellis/scripts/spec_router.py:295`。
- 已确认用户决策：保留现有 frontmatter 解析代码作为向后兼容能力，但不推广、不新增、不依赖 `triggers`；本轮主路径是路径 / 标题 / index 描述 / token 置信度。
- 关键源文件：`vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`、`vendor/skill-garden/.trellis/0.6/overrides/workflow.md`、`vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md`。
- 同步目标：`enhancements/0.6/**`、`.trellis/scripts/spec_router.py`、`.trellis/workflow.md`。
- 风险点：index 描述解析必须保守；如果引入误报，应保留 token set 和置信度改造，暂时禁用 index 加权。

## Acceptance

- workflow hub / workflow-state 文案不再使用容易过宽理解的 `procedural or high-impact` 作为唯一触发边界。
- 负例查询不再误召回无关文档：
  - `open IntelliJ IDEA for current project local tool launch`
  - `explain spec_router.py optimization directions trigger breadth`
  - `edit README documentation typo small change`
  - `draw architecture diagram visualize flow`
  - `commit push changes to beta branch`
- 正例查询仍能召回目标文档：
  - `beta release publish tag changelog npm` 高置信召回 `.trellis/spec/flower-trellis/cli/release-and-publishing.md`
  - `cross layer reuse thinking guide` 召回 `.trellis/spec/guides/` 下相关 thinking guide
- 输出包含置信度字段，并让高 / 中置信候选对应不同 action 文案。
- Python 语法检查、`npm run sync`、源 / 快照 / dogfood 同步检查和 `git diff --check` 通过。

## Next Step

- 用户确认 planning artifacts 和本 brief 后，运行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/07-02-spec-router-knowledge-discovery-optimization`，然后进入 Phase 2.1 的 `trellis-route(implement)`。
