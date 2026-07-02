# 优化 spec_router 项目知识发现

## 目标

优化 `spec_router.py` 和对应 workflow 提示，让 Trellis 在“项目局部知识可能影响做法”的场景中更稳定地发现 SOP / spec / thinking guide，同时避免把普通问答、只读查看、本地工具打开和轻量操作都变成检索流程。

## 背景

- 当前 `spec_router.py` 的定位是随 skill-garden 0.6 分发的通用项目知识发现器，扫描目标项目 `.trellis/spec/**/*.md`，只返回候选路径和命中原因，不注入完整文档。
- 当前 workflow 触发文案是 `Before procedural or high-impact actions`，其中 `procedural` 容易被理解为“任何流程性命令前都运行”，触发边界偏宽。
- 当前脚本在路径、标题、正文匹配时使用子串判断：`.trellis/scripts/spec_router.py:285`、`.trellis/scripts/spec_router.py:290`、`.trellis/scripts/spec_router.py:295`。这会让 `to`、`flow`、`commit`、`command` 等泛词产生误召回。
- 已压测的误报例子：
  - `commit push changes to beta branch` 误召回 thinking guide / directory structure。
  - `draw architecture diagram visualize flow` 误召回多份 CLI spec。
  - `database migration data fix rollback` 在没有专门 DB SOP 时召回 cross-layer guide，属于可解释但置信度不足。
- 已压测的正例：
  - `beta release publish tag changelog npm` 能准确召回 `.trellis/spec/flower-trellis/cli/release-and-publishing.md`。
- 用户明确反馈：不希望把 `frontmatter triggers` 作为主要设计方向，因为它会引入额外机器索引维护成本，并可能长期语义漂移。
- 已确认决策：保留现有 frontmatter 解析代码作为向后兼容能力，但不推广、不新增、不依赖 `triggers`；本轮主路径是路径 / 标题 / index 描述 / token 置信度。

## 需求

### R1. 收窄但不收死触发边界

- workflow 应从“流程性或高影响动作前触发”改为“项目局部知识可能影响做法的决策边界触发”。
- 应明确适用场景：非平凡项目工作开始前、Trellis / workflow / config / hooks 变更、CLI 行为变更、发布 / 提交 / 推送 / tag、数据变更、迁移、回滚、破坏性操作、跨层设计、状态流转或生成 / 安装 / 同步链路变更。
- 应明确非适用场景：纯问答、简单只读查看、打开本地工具、普通定位文件、轻量文案 / 拼写修改，除非请求明确提到项目约定。
- 触发粒度应是“一个用户意图 / 一个阶段 / 一个决策边界”，不是每条 shell 命令前重复运行。

### R2. 改造匹配算法，降低泛词误报

- 文档路径、标题、正文样本都应先 token 化，再做 token set 匹配，禁止用任意子串命中作为有效匹配依据。
- 泛词 / 弱词应扩展到能覆盖 `to`、`and`、`or`、`of`、`in`、`for`、`with`、`from`、`the`、`run`、`change`、`update`、`flow`、`data`、`command`、`commit`、`changes` 等误报来源。
- 候选必须具备强锚点或足够强的组合证据：
  - 路径或标题命中非泛词 token；
  - 或 index 描述命中非泛词 token；
  - 或标题 / 正文命中多个强 token，但正文不能单独因为少量泛词成为高置信候选。
- `frontmatter triggers` 不作为本轮主设计；如保留现有解析，也只能作为兼容旧文档的弱入口或非推广能力。

### R3. 使用非侵入式文档结构增强召回

- 优先利用现有文档自然结构：文件路径、文件名、H1-H3 标题、正文开头摘要。
- 探索解析 `.trellis/spec/**/index.md` 中的链接文本和邻近描述，把它作为目标文档的路由描述加权。
- `index.md` 默认不应挤掉更具体文档；当 index 明确描述目标文档时，最终候选应优先落到被链接的具体文档。

### R4. 输出置信度和更克制的行动建议

- 输出中应增加 `confidence`，至少区分 `high` / `medium`。
- 高置信候选使用 `action: read before acting`。
- 中置信候选使用更克制的行动建议，例如 `action: read if clearly relevant`。
- 低置信候选默认不输出，可考虑只在 `--debug` 中展示。
- 默认候选数量继续保持保守，避免上下文膨胀。

### R5. 同步分发链路

- 优先修改源文件 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 和 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`。
- 通过 `npm run sync` 同步到 `enhancements/0.6/`。
- 同步本仓 dogfood 副本 `.trellis/scripts/spec_router.py` 和 `.trellis/workflow.md`，保证当前项目立即使用新行为。
- 不修改 Trellis 上游核心脚本，不新增第三方依赖，不引入向量检索或持久索引。

## 非目标

- 不为每个 SOP 创建新 Skill。
- 不把项目私有 SOP 内容复制进 skill-garden。
- 不推广 `frontmatter triggers` 作为主要路由机制。
- 不做 hook 自动执行 `spec_router.py`。
- 不引入 BM25、向量数据库、外部索引服务或持久缓存。

## 验收标准

- [ ] workflow hub / workflow-state 文案不再使用容易过宽理解的 `procedural or high-impact` 作为唯一触发边界。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "open IntelliJ IDEA for current project local tool launch"` 返回空候选。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "explain spec_router.py optimization directions trigger breadth"` 返回空候选，或不要求读取无关 SOP。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "edit README documentation typo small change"` 返回空候选。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "draw architecture diagram visualize flow"` 不再因为 `flow` 等泛词误召回 CLI spec。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "commit push changes to beta branch"` 不再因为 `to` / `changes` 等泛词误召回无关文档。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "beta release publish tag changelog npm"` 仍能高置信召回 `.trellis/spec/flower-trellis/cli/release-and-publishing.md`。
- [ ] `python3 ./.trellis/scripts/spec_router.py --json "cross layer reuse thinking guide"` 仍能召回 `.trellis/spec/guides/` 下相关 thinking guide。
- [ ] 输出包含置信度字段，并让高 / 中置信候选对应不同 action 文案。
- [ ] Python 语法检查通过：
  - `python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`
  - `python3 -m py_compile enhancements/0.6/scripts/spec_router.py`
  - `python3 -m py_compile .trellis/scripts/spec_router.py`
- [ ] `npm run sync` 后源、快照和 dogfood 副本保持一致或差异有明确解释。
- [ ] `git diff --check` 通过。

## 开放问题

无。
