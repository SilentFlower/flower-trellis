# Astra SessionStart 提示设计

## Architecture

按用户最新调整，首版仅在 Codex SessionStart 的 `startup / clear / compact` 中注入，且仅 state 分段追加一次。普通 UserPromptSubmit 保持原工作流输出，不新增提示、注册或状态文件。

实际注入正文使用英文，与 workflow 主体一致；源码维护性注释使用中文。提示正文及生成函数直接维护在唯一消费者 `src/assets/flower_session_start.py`，由既有 Flower asset 投影到 `.trellis/scripts/flower_session_start.py`。不再新增独立 helper 文件或修改 shared-runtime Patch。`src/lib/flower-assets.js` 明确 Flower 自有资产不属于 Skill-Garden 同步快照；沿用现有正常安装链，源/安装结果一致性和未受影响快照分别检查。

## Injection Contract

1. 仅 `hook=.codex/hooks/session-start.py`、`part=state`、`source` 为 startup/clear/compact、`model` 严格为字符串 gpt-6-astra 时考虑新增提示。不 trim 模型名、不猜别名、不读取默认模型。
2. 原生 main 和工作流块提取成功后才追加；rules/stages 不调用提示生成器，不依赖 state 的副作用或先后顺序。
3. 项目 `.trellis/config.yaml` 拟新增 `codex.astra_workflow_hint`，缺省开启。沿用现有 `common.trellis_config.read_trellis_config`；它将 YAML 标量返回字符串，因此兼容布尔值及明确的 true/false 字符串，不对字符串使用 truthy 判断。非法显式值停用新增提示并诊断。
4. 完整提示块不超过 2048 字节 UTF-8，含版本和 Astra 适用范围。保留 PRD 候选六项语义；内部检查不要求逐项报告。模板要求保留结构，普通问答保持简短。
5. 新增提示生成异常只影响该可选提示，保留原生 state、规则与已有诊断，附简短 systemMessage；不得把失败当成成功注入。
6. 全局禁用、Codex 非交互、resume、原生 should_skip_injection 和原工作流错误诊断维持原契约。不改变 hooks.json、matcher、命令、超时或额度。
7. no-trellis 仍只跳过 UserPromptSubmit，不影响 SessionStart；关闭本功能使用独立配置。每个匹配的 SessionStart 重新判断模型，普通轮次/模型切换不立即刷新，也不撤回历史指令。

## Conflict Review

按 research/feasibility.md 的事实清单核对通用避免标题与 Brief 分节模板、主动执行与授权边界、必读引用与普通问答开销。仅修改已确认归属且直接相关的可配置规则，未找到可编辑源的宿主限制如实记录。Hook 为 developer 补充，不能将所有宿主要求一概判为更高层或声称覆盖 system。原事件未回放，不推测“没读文件”的原因。

## Context Budget

新增提示仅随 SessionStart 的 state 出现。预算 fixture 必须覆盖 Astra/其他模型/缺失模型、开关和 startup/clear/compact；实际输出计量完整块和各分段字节数及增量，继续保留字符指标。取有效事件与平台中最大合计计入既有 control-context-total 公式，不重复累计等价入口，不调高原预算或 additionalContextLimit。

## Behavioral Experiment

六个场景各 5 次关闭、5 次开启，首轮共 60 个独立场景运行；固定 Astra、推理设置、宿主版本、技能/工作流、权限和输入。以 SessionStart 注入为唯一实验变量；场景内部允许多轮，不在后续 UserPromptSubmit 再注入。

先冻结输入及评分，再交错运行开关组，保存提示哈希、真实工具记录、输出和产物。B1 同时检查文件与对话展示；B2 检查缺失引用完整补读；B3/B4 分别验证授权前后；B5 先产生真实读取记录再质疑；B6 检查冗长和无谓工具调用。

报告模板成功、步骤遗漏、无依据陈述、额外确认、工具次数、回答长度和上下文成本的分子/分母。宿主提供 token 时另记，不用 bytes 代替 token。工程完成与行为结论分别标记；不能运行真实 Astra/Codex 时保留未完成项，不用模拟输入或其他模型替代行为实验。有限样本不宣称长期稳定。

## Rollback

设置 `codex.astra_workflow_hint: false` 后，后续 SessionStart 不再新增提示；无历史干扰的实验使用新会话。源码回滚及本项目 dogfood 更新均走 Flower 正常资产投影，保留用户开关、原 Hook 配置、额度和其他插件状态。
