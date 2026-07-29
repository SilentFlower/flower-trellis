# 实施计划

## 执行顺序

1. 建立基线测试
   - 新增 `test/python/test_spec_router.py`，使用临时 `.trellis/spec/` fixture 并直接加载 canonical 源脚本。
   - 固化现有 JSON 字段、默认 limit、无匹配行为和历史正负例。
   - 增加小文件、长文档后半章节、fenced code 伪标题、路径/index-only、超预算章节和父子重叠场景。

2. 实现 canonical 章节模型
   - 在 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 增加章节与章节匹配数据类。
   - 保留 `parse_frontmatter()` 公开形状，新增原文件行号感知的章节解析 helper。
   - 已有文件锚点继续使用过滤测试/验证/示例章节后的正文前缀；无文件锚点时只采用单个最佳章节的正文证据，避免分散弱词聚合。
   - 生成 `full | sections | outline` 计划，执行非重叠、数量和字节预算约束。
   - 扩展 Markdown / JSON 输出并保持旧字段兼容。

3. 更新读取策略 owner
   - 修改 `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/intent-routing/request-triage/content.md`，让 AI 遵循 `load_strategy` 并仅在局部内容不足时扩展。
   - 更新 workflow owner 相关断言，确认 `trellis-before-dev` 和 workflow-state 没有复制完整策略。
   - 更新 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 的 Project Knowledge Discovery 契约、输出模型和验证矩阵。

4. 同步生成物与 dogfood
   - 在 `vendor/skill-garden` 中刷新 canonical compiled targets。
   - 运行 `npm run sync` 生成 `enhancements/0.6` 快照与 manifest。
   - 将快照脚本同步到 `.trellis/scripts/spec_router.py`，并通过项目 Patch/dogfood 流程刷新 `.trellis/workflow.md`。
   - 核对 canonical、快照、dogfood 三份脚本逐字节一致，Patch 源与快照一致。

5. 验证
   - 定向单元测试：
     ```bash
     python3 -m unittest discover -s test/python -p 'test_spec_router.py'
     ```
   - Python 语法：
     ```bash
     python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/spec_router.py
     python3 -m py_compile enhancements/0.6/scripts/spec_router.py
     python3 -m py_compile .trellis/scripts/spec_router.py
     ```
   - 同步一致性：
     ```bash
     cmp -s vendor/skill-garden/.trellis/0.6/scripts/spec_router.py enhancements/0.6/scripts/spec_router.py
     cmp -s enhancements/0.6/scripts/spec_router.py .trellis/scripts/spec_router.py
     ```
   - 完整质量门禁：
     ```bash
     npm test
     npm run patch:targets:check
     node scripts/check-ai-context-budget.mjs --strict
     git diff --check
     ```
   - 手工正负例：发版、thinking guide、章节后半命中、轻量编辑、打开 IDEA、泛词 flow/commit。

## 关键测试断言

- H1-H3 章节路径和原文件行号正确，frontmatter 不造成偏移。
- fenced code block 内 `##` 不创建章节。
- 小文件选择 `full`；长文件有预算内强章节时选择 `sections`；不能安全缩小时选择 `outline`。
- `sections` 至多 2 个、互不重叠、总字节数不超预算。
- JSON 旧字段集合仍存在，新增字段稳定；Markdown 不含正文内容。
- 文件级 top 3、high/medium 排序和历史正负例不回归。
- workflow 最终目标包含加载策略，但 SessionStart / state / before-dev 不出现重复长规则。

## 风险文件

- `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`：canonical helper 和主要行为变更。
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/intent-routing/request-triage/content.md`：高频 workflow owner，必须控制文本增长。
- `vendor/skill-garden/compiled-targets/0.6.5/**`：Patch 源变化后的维护审阅产物。
- `enhancements/0.6/**` 与 `enhancements/MANIFEST.json`：由同步脚本生成，不手工维护正文。
- `.trellis/scripts/spec_router.py` / `.trellis/workflow.md`：本仓 dogfood 副本。
- `.trellis/spec/flower-trellis/cli/enhancements-model.md`：项目级行为契约。

## 回滚点

- 章节解析不稳定：保留新增输出字段，但统一退化为 `outline`，文件级召回不回滚。
- 章节预算导致常见短 SOP 读取不便：只调整 `FULL_FILE_MAX_BYTES`，不得取消预算或改成默认全文。
- workflow 上下文超限：压缩或替换原读取句，不提高预算阈值、不复制到其它层。
- 同步产生非预期大 diff：停止在生成步骤，先核对 submodule HEAD、manifest 和 compiled targets，再继续 dogfood。
