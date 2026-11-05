# SessionStart 索引超限调查

## Observed Failure

- 报告项目：`/root/project/xiaoxian-desktop`；Flower/Skill-Garden 声明及 lock 版本为 `0.6.12`。
- 会话：`01a1a9c2-0e49-7610-b202-74933bc299d3`。
- 原始记录：`/root/.codex/sessions/2026/11/05/rollout-2026-11-05T11-30-29-01a1a9c2-0e49-7610-b202-74933bc299d3.jsonl`，调查时最后一次 state 注入位于第 7161 行，时间 `2026-11-05T10:23:20.022Z`。
- 宿主保存的原始全文：`/tmp/hook_outputs/01a1a9c2-0e49-7610-b202-74933bc299d3/b2b6340c-0b5b-43dd-a316-82fc7fea0cce.txt`。该文件位于临时目录，后续验收不能依赖它持续存在。

| 测量对象 | 结果 |
| --- | --- |
| 规范索引总数 | 499 |
| 全量索引列表 | 28021 字符 |
| 原始 state | 34603 字符、34631 UTF-8 字节 |
| 宿主交付的 state 表示 | 10101 字符，包含明确的中间截断标记及全文路径 |
| 中间截断造成的缺失 | `guidelines` 闭合标签、完整 `task-status`、`codex-mode` 起始部分 |
| 内存中替换索引列表后的样本 | 6713 字符 |

内存模拟只替换 `## Available indexes (read on demand)` 及其连续索引路径列表，加入固定发现提示；`task-status`、`workflow-state`、代码设计、Codex 同步交互和 Sol 6.1 提示块均与原始全文逐字相同。此结果不等于真实 Hook 已修复，也不构成宿主已收到完整内容的证据。

## Root Cause And Ownership

- 目标 `.codex/hooks/session-start.py:339` 的 `_collect_spec_index_paths()` 枚举索引，`:449` 把总数写入当前状态，`:578` 的循环再次把全部路径写入 `guidelines`。
- 目标 `.claude/hooks/session-start.py:927` 存在相同的输出块，使用相同缩进和原文；其收集器带 `allowed_pkgs` 参数，修复不能丢失该既有筛选语义。
- `src/assets/flower_session_start.py:421` 只在最终分段超出 `MAX_PART_CHARS=8000` 时追加诊断，并保留全文。这是可见诊断机制；实际中间截断由宿主执行。
- Skill-Garden 0.6 已有 `overrides/patches/hooks/session-start/context-trim/patch.json`，管理 Codex、Claude、CodeBuddy、Cursor、Factory、Gemini、Kiro、Qoder、Trae、ZCode 的原生启动内容精简。新行为应作为该 Patch 的一项精确替换，由既有 Bundle 投影。
- 持久作者源是 `vendor/skill-garden/.trellis/0.6/`；`enhancements/0.6/` 是同步快照，`compiled-targets/0.6.14/full/targets/` 是当前 pinned Trellis 的最终审阅产物，项目 `.codex/`、`.claude/` 是运行副本。
- `vendor/skill-garden/.trellis/0.6/scripts/spec_router.py` 已存在；按任务清单和关键词发现规范不需要新增选择器、依赖或持久状态。

## Existing Verification And Gaps

- `test/python/test_flower_session_start.py` 已验证三段完整性、8000 字符目标、原生标准流隔离、刷新、模型提示、禁用和超限可见诊断；夹具复制 Flower 当前少量规范和本地原生 hook。
- `scripts/check-ai-context-budget.mjs:139` 的 `measureSessionStart()` 覆盖十八个模型/事件场景，但规范目录也来自 Flower 本地，尚无大规模索引夹具。SessionStart 原生 hook 当前读取本地运行副本，而 workflow-state hook 读取编译目标，需把受测 Hook 对齐最新编译结果。
- `test/js/ai-context-budget.test.js` 固定十八场景及模型提示差值、最大平台合计、默认与 strict 告警语义；追加规模场景时必须保留这些断言。
- `test/js/platform-patches.test.js` 和 `test/js/apply-enhancements.test.js` 已覆盖 `additionalContextLimit` 的继承、显式值和重复应用，不应通过调额度修复。
- `test/python/test_skill_garden_patches.py`、`scripts/check-patch-conflicts.mjs` 及 compiled-target 检查承担多平台投影与 Patch 一致性验证。

## Workflow And Scope

- 这是一个根因、一个可共同验收的修复任务；不拆父子任务。
- 本调查完成时仅创建了规划材料，尚未执行 `task.py start` 或修改实现；后续实施状态与运行证据见任务 `validation.md`。
- 创建任务授权来自用户“新建任务修复这个问题”；实施仍遵守 `trellis-task-brief` 的首次完整 Brief 评审门禁。
- 官方机制参考：<https://learn.chatgpt.com/docs/hooks#sessionstart>。已通过 OpenAI Docs 获取原文，确认 `compact` 后会在继续模型请求前运行匹配的 SessionStart Hook；具体超限与截断结论来自本地记录。
