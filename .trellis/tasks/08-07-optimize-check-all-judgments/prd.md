# 优化 Check-All 判定与上下文体量

## Goal

在不削弱 Check-All 审计门禁的前提下，提高低风险变更命中 light 的稳定性，减少真实兜底问题因证据门槛过严而漏报，并允许窄范围、可唯一验证的源码注释事实漂移自动修复。同时控制 Check-All 默认必读上下文，不通过追加第二套规则扩大入口和高频 reference。

## Background

- 当前 Check-All 使用 `CHK-*`、`FBK-*`、`DOC-*` 三类问题模型，普通代码、配置和测试默认 audit-only，只有低风险文档漂移可以自动修复。
- 当前 `FBK-*` 要求具体位置、可达场景、问题证据、保护收益和验证方式同时完备，分类身份与证据完备度耦合，可能让根因明确属于保护路径的问题退回“部分验证”或剩余风险。
- 当前 hard-full 包含 workflow、skill、command、hook、生成快照以及安装、升级、发布、push/commit 控制面等主题域。规则没有明确区分解释性文本与真实行为契约变化，导致这些载体中的低风险修改容易直接进入 full。
- 当前 `.agents/skills/trellis-check-all/SKILL.md` 为薄入口，详细规则位于 `references/`。项目规范要求优先替换或删除旧规则，禁止“旧规则保留 + 新高优先级段继续追加”。
- AI 上下文预算以最终 compiled target 和真实运行输出为准；不能只看 Patch source 或单个 dogfood 副本。
- 当前专用 Check-All subagent 是严格 audit-only，只能返回 `DOC-*` 候选；任何允许的自动修复都由主会话落地。
- 当前 auto-loop 的 `--doc-remediation-file` 只处理任务 `implement.md` / `brief.md` 的 planning/handoff 重绑定。源码注释变化不属于该参数，但仍会改变本轮实际 diff，因此必须重新核对最终 diff 和验证证据。
- 现有全局 AI context budget checker 不单独计量 Check-All 入口与其必读 references；本任务需要在 Check-All 专项测试中增加确定性字节预算守卫。

## Requirements

### R1. 上下文体量约束

- 三项改造必须替换现有判据，不得保留旧判据后再追加一套覆盖规则。
- Check-All 主 `SKILL.md` 保持薄入口，不展开注释类型矩阵、FBK 证据矩阵或 light/full 完整判定表。
- 默认必读 reference 的最终字节数不得因本任务净增长；确有新增的代码注释细则必须条件加载，只在发现源码注释自动修复候选时读取。
- 以 canonical `.agents` Check-All 入口和默认必读 references 的任务开始时 UTF-8 字节数为专项基线，并验证 `.claude` 对等副本；条件加载文件不计入默认必读集合，但必须单独展示其字节数。
- 复用现有 `DOC-*`、`FBK-*`、`check_profile.reasons` 和统一报告结构，不新增平行问题通道或重复报告区。
- 不通过提高 AI context budget target 或 review ceiling 掩盖增长。

### R2. 源码注释事实自动修复

- 允许自动修复可由当前实际 diff 或已验证仓库事实唯一推出的机械引用漂移，例如符号名、路径、命令名、配置键、URL 或版本引用。
- 允许同步局部实现事实，例如内部常量值、默认值、重试次数、超时时间、内部组件名称或已确定的内部实现机制；底层事实必须由本轮 diff 和任务规划、测试结果或其它已读取的权威证据共同证明为有意变化。
- 自动修复只替换注释中的具体事实片段，不整句润色、不删除注释，也不顺带改写同一注释中的其它表达。
- 描述行为、契约、约束、原因、业务语义或安全边界的注释不得自动修复。
- 公共 API 的 Javadoc/docstring、工具指令、lint/type-ignore、构建标签、license、TODO/FIXME、可执行示例不得进入自动修复白名单。
- 自动修复只能改变注释文本，必须保留原缩进、注释形式和周围可执行代码，并在报告中作为现有 `DOC-*` 子类型展示。
- 专用 Check-All subagent 始终只返回候选，不得直接应用注释修复；主会话负责重新审阅候选和执行允许的写入。
- interactive 与 validated auto-loop 都允许主会话落地符合白名单的注释修复；auto-loop 不使用 `--doc-remediation-file` 声明源码注释变化。
- 注释修复后必须重读最终 diff、重新计算检查范围、复核 `check_profile` 是否仍成立，并重跑受影响的无副作用定向验证后才能输出或 record 最终结果；无法唯一判断代码与注释谁正确时按普通 finding 处理。

### R3. FBK 分类与证据状态解耦

- 是否属于 `FBK-*` 先按根因是否位于 fail-closed、异常输入、失败降级、权限或数据保护、容错和故障可观测性保护路径判断，不由验证环境是否齐备决定。
- `FBK-*` 的硬准入仅保留可定位的保护边界、代码或契约上可达的具体异常场景，以及当前保护缺失、错误、过度降级或可绕过的证据。
- 不要求异常已经在生产、测试或当前运行中真实发生；静态可达路径可以构成场景证据。
- 保护收益和验证方式继续作为报告必填信息；验证条件暂不具备时明确标记部分验证或缺失条件，不得因此改变 FBK 根因分类。
- 纯风格偏好、主观重构建议和没有具体触发路径的“增强健壮性”建议仍不报告。

### R4. light/full 按行为契约影响路由

- hard-full 从主题域或载体命中改为实际行为契约影响命中；文件位于 workflow、skill、command、hook 或生成快照中，不再单独构成 hard-full。
- 以下行为变化继续直接 full：公共 API/CLI/schema/状态与协议、数据持久化和迁移、权限与安全、并发与时序、发布或 Git 控制门禁、跨独立行为边界以及无法闭合的影响面。
- 注释、错别字、排版、解释性文字、不改变行为的示例、同一语义源的机械投影同步，应在范围可闭合且存在定向验证时命中 light。
- 单一局部行为修改在直接引用点和回归路径可穷举、且存在定向验证时允许 light，不因载体属于 skill/workflow 自动升级。
- 用户显式 full 继续直接 full；用户显式 light 不能突破真实行为 hard-full；auto 无法确认行为影响或无法闭合范围时继续 fallback-full。
- light 执行中发现行为影响扩大或关键验证缺口时单向升级 full；已有 full 修复/重检链不得降级。

### R5. 可审计与防回归

- `check_profile` 继续输出 requested/effective depth、confidence 和简短原因；原因必须指向具体行为影响或无法闭合项，不能只写“涉及 skill/workflow”。
- 深度路由测试至少覆盖：skill 错别字、workflow 解释文字、机械投影同步、局部行为加定向测试命中 light；门禁顺序、hook 状态流转、CLI/持久化契约和未知影响命中 full。
- FBK 测试至少覆盖：静态可达但未实际复现的保护缺口仍归 FBK；缺少验证环境时保留 FBK 分类并标记验证不足；泛化建议不报告。
- 注释自动修复测试至少覆盖允许的机械引用和全部禁止类别，并证明最终 diff 没有可执行代码变化。

### R6. Source Of Truth 与分发一致性

- 先修改 `vendor/skill-garden/.trellis/0.6/` canonical 源，再同步 `enhancements/0.6` 和当前 dogfood 副本。
- `.agents` 与 `.claude` 对应 Check-All 规则保持一致。
- 若改动影响 compiled target，按项目 SOP 刷新并检查 canonical compiled targets。
- 0.5 和 old 变体不在本任务范围内。

## Acceptance Criteria

- [ ] AC1：现行主题域 hard-full 被行为契约影响判据替换，未保留两套相互覆盖的判定规则。
- [ ] AC2：约定的四类低风险样例稳定选择 light，四类真实行为或未知影响样例稳定选择 full。
- [ ] AC3：真实保护路径问题不会仅因缺少运行时复现或验证环境而失去 `FBK-*` 分类，泛化建议仍被过滤。
- [ ] AC4：源码注释只有可唯一验证的机械引用与局部实现事实漂移能够自动修复，公共契约、Why、业务/安全语义、工具指令和可执行示例等类别保持 audit-only。
- [ ] AC5：注释修复只产生注释文本 diff，修复内容与验证结果复用现有 `DOC-*` 报告区展示。
- [ ] AC6：主 `SKILL.md` 保持薄入口，默认必读 reference 的最终字节数不高于任务开始时基线；新增注释细则为条件加载。
- [ ] AC7：未提高任何 AI context budget target/review ceiling，默认与 strict 预算检查均通过既有门禁。
- [ ] AC8：canonical 源、双平台副本、发布快照、dogfood 与适用 compiled targets 保持一致，相关自动测试通过。

## Out Of Scope

- 不改变 Check-All 的三维检查顺序、interactive/auto-loop 最终处置流程或 Git 提交门禁。
- 不让 Check-All 自动修复普通代码、配置、测试、迁移或业务语义问题。
- 不新增新的问题编号体系、持久化 finding 状态或独立深度路由器。
- 不调整 0.5、old 变体或上游原生 `trellis-check` 行为。
