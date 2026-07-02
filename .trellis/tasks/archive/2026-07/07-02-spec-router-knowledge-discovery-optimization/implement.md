# 实施计划

## 执行顺序

1. 基线验证
   - 运行当前正负例查询，记录现有输出，确认误报和正例。
   - 读取 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`、`enhancements/0.6/scripts/spec_router.py`、`.trellis/scripts/spec_router.py`，确认三份当前是否一致。

2. 改源脚本
   - 在 `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 中重构 token 匹配。
   - 扩展弱词集合。
   - 增加路径 / 标题 / index 描述 / 正文样本的 token set 匹配。
   - 增加 index 描述收集逻辑。
   - 增加 `confidence` 和 action 选择。
   - 保留 frontmatter 解析，不新增、不推广、不依赖 `triggers`。

3. 改 workflow 源文案
   - 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow.md` 的 Project Knowledge Discovery 小节。
   - 修改 `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md` 中的短提示。

4. 同步快照与 dogfood
   - 运行 `npm run sync`。
   - 检查 `enhancements/0.6/scripts/spec_router.py` 与源文件一致。
   - 同步 `.trellis/scripts/spec_router.py` 和 `.trellis/workflow.md`。
   - 检查 workflow-state dogfood 文案是否需要同步。

5. 验证
   - Python 语法检查：
     ```bash
     python3 -m py_compile vendor/skill-garden/.trellis/0.6/scripts/spec_router.py
     python3 -m py_compile enhancements/0.6/scripts/spec_router.py
     python3 -m py_compile .trellis/scripts/spec_router.py
     ```
   - 查询负例：
     ```bash
     python3 ./.trellis/scripts/spec_router.py --json "open IntelliJ IDEA for current project local tool launch"
     python3 ./.trellis/scripts/spec_router.py --json "explain spec_router.py optimization directions trigger breadth"
     python3 ./.trellis/scripts/spec_router.py --json "edit README documentation typo small change"
     python3 ./.trellis/scripts/spec_router.py --json "draw architecture diagram visualize flow"
     python3 ./.trellis/scripts/spec_router.py --json "commit push changes to beta branch"
     ```
   - 查询正例：
     ```bash
     python3 ./.trellis/scripts/spec_router.py --json "beta release publish tag changelog npm"
     python3 ./.trellis/scripts/spec_router.py --json "cross layer reuse thinking guide"
     ```
   - 同步检查：
     ```bash
     cmp -s vendor/skill-garden/.trellis/0.6/scripts/spec_router.py enhancements/0.6/scripts/spec_router.py
     cmp -s enhancements/0.6/scripts/spec_router.py .trellis/scripts/spec_router.py
     git diff --check
     ```

## 风险文件

- `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py`：源脚本，优先修改。
- `vendor/skill-garden/.trellis/0.6/overrides/workflow.md`：高优先级 workflow hub 源。
- `vendor/skill-garden/.trellis/0.6/overrides/workflow-states/*.md`：高频状态提示源。
- `enhancements/0.6/**`：由 `npm run sync` 生成，避免手写为主。
- `.trellis/scripts/spec_router.py` / `.trellis/workflow.md`：dogfood 副本，需要与快照语义一致。

## 回滚点

- 若新匹配模型正例漏检，先回退强锚点阈值，不回退 workflow 文案。
- 若 index 描述解析引入误报，保留 token set 和置信度改造，暂时禁用 index 加权。
- 若同步链路产生非预期大 diff，停止在 `npm run sync` 后，先审查 `enhancements/0.6` 差异再继续。
