# 可行性核查与来源

核查日期：2026-09-05。证据来自本次对话前一轮实际读取的本地文件、官方文档和预算命令；不代表已执行新增功能或行为 A/B。

## Official Contracts

- [Codex Hook 通用输入](https://learn.chatgpt.com/docs/hooks#common-input-fields)：`model` 为当前模型 slug。
- [UserPromptSubmit](https://learn.chatgpt.com/docs/hooks#userpromptsubmit)：`turn_id`、`prompt` 是事件字段；matcher 不用于筛选；additionalContext 注入为 developer 上下文。
- [SessionStart](https://learn.chatgpt.com/docs/hooks#sessionstart)：支持 `source=compact`；根会话自动压缩发生在轮次中时，额外上下文在立即继续推理前交付。此表未列 `prompt`/`turn_id`，不能依赖这些未证实字段恢复单轮 skip。
- [大输出处理](https://learn.chatgpt.com/docs/hooks#large-hook-output)：宿主按近似 token 额度处理过长输出，可落盘并给模型预览；字节数与 token 不等价。
- [Astra 指令遵循](https://developers.openai.com/api/docs/guides/latest-model#instruction-following)：建议核对技能和 AGENTS 中可能互相影响的规则，明确用户指令与技能指引的关系；该建议不是效果保证。

官方契约已读；当前安装客户端的完整事件顺序、实际传入 slug 和新提示接收均待实施阶段现场记录。

## Local Anchors

| 文件与位置 | 已确认事实 |
| --- | --- |
| `.codex/hooks.json:3` | UserPromptSubmit 已注册一个 workflow-state handler。 |
| `vendor/skill-garden/.trellis/0.6/overrides/patches/hooks/inject-workflow-state/shared-runtime/patch.json` | `workflow-state-main-subject-routing` 用 main-content.py 替换多平台主入口。 |
| 同目录 `main-content.py:1`、`:15`、`:50` | 全局禁用、skip 早退位于已有 Codex 拼接分支前。 |
| `.codex/hooks/inject-workflow-state.py:151` | 平台判断复用现有运行环境/入口识别，model 不参与平台判断。 |
| `src/assets/flower_session_start.py:48` | state 执行原生 main，rules/stages 直接读取生成器；分段不能依赖先后顺序。 |
| `src/assets/flower_session_start.py:108` | 保留全局禁用、Codex 非交互禁用与 resume 跳过。 |
| `.trellis/config.yaml:145` | skip_keyword 只作用每轮 breadcrumb，不影响 SessionStart 和子代理上下文。 |
| `src/builtin-plugins/skill-garden/content-adapter.js:726` | variant scripts 平铺投影到目标 `.trellis/scripts/`，带 Plugin ownership。 |
| `scripts/check-ai-context-budget.mjs:144`、`:179` | 现有 SessionStart 预算只运行 startup 且没有 model，不能覆盖新增 Astra 命中路径。 |
| `.agents/skills/trellis-task-brief/SKILL.md:54`、`:122` | Brief 定义章节模板，要求文件正文完整展示，不允许压缩改写字段结构。 |

## Initial Conflict Inventory

| 规则组合 | 证据与归属 | 当前处置 |
| --- | --- | --- |
| 通用避免章节标题 / Brief 完整分节展示 | 前者来自当前会话宿主 developer 写作要求；后者为已完整读取的本地技能。检查 `/root/.codex/AGENTS.md`、项目 AGENTS 和相关技能/源 Patch 后未找到前者的本地可编辑源。 | 记录冲突，新增提示明确适用模板；不得称可覆盖所有宿主规则。对话展示原始 Markdown 可用代码块保留原文，不能以扁平摘要代替。 |
| 自动推进 / planning 需当前 Brief 授权 | 当前宿主授权规则与 Trellis planning/brief 规则均存在；后者明示当前 Brief 预授权例外。 | 以当前用户明确授权和指令层级判断，不能因普通开始任务意图凭空跳过必需规划，也不能重复索取已有有效授权。 |
| 每步必读 / 避免无谓工具调用 | 用户候选允许已完整读取且未变化的内容复用。 | 只补读当前适用步骤的缺失引用；B2、B6 覆盖必要读取与普通问答退化。 |

这里只陈述当前规则关系，不将其当作此前“扁平展示/没读”事件的已证实根因。用户描述的原事件未在本轮回放。

## Baseline

已运行 `node scripts/check-ai-context-budget.mjs`，退出 0：

- 候选正文规范化软换行后：350 字符、966 字节 UTF-8，未计最终外层标记。
- SessionStart 最大平台合计：13802 字节；Codex state：1952 字节。
- control-context-total：110159 字节，target 118784，review 131072。
- states-total：13119 字节，已有 warn；target 12288，review 14336。本任务不通过调高阈值隐藏增长。
- 以上是修改前数据，不构成新增提示效果或最终注入预算证据。

## Working Tree Boundary

任务创建前主仓已有 `.flower/plugins.json`、`.flower/plugin-lock.json` 修改，`.agents/skills/xhgj-gitlab-collaboration/`、`.claude/skills/xhgj-gitlab-collaboration/`、`.trellis/tasks/09-05-beginner-usage-guide/` 未跟踪。vendor 子仓核查时干净。

这部分现有工作不属于本任务；正常安装/更新前须再次核对并保留。

## 最新范围调整

用户在原 Brief 确认后要求先试 SessionStart，减少重复。当前仅在 startup/clear/compact 的 state 注入，UserPromptSubmit 不改；会话中切换模型等待下次 SessionStart 才重新判断。上述原入口锚点作为历史研究保留，不是当前改动范围。

进一步读取 `src/lib/flower-assets.js` 确认 SessionStart 脚本是 Flower 自有资产，不通过 Skill-Garden 快照同步。因此提示正文直接放唯一消费者 `src/assets/flower_session_start.py`，通过已有投影安装，无须新建跨入口 helper。

进一步读取 `common.trellis_config` 确认 YAML 标量会返回字符串，开关需明确解析 true/false，不能把普通字符串当布尔真值。
