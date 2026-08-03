# Trellis 0.6.12 升级冲突清单

## 审计范围

- 当前基线：Trellis `0.6.5`
- 目标版本：Trellis `0.6.12`
- 上游来源：`mindfold-ai/trellis` 官方仓库的 `v0.6.5...v0.6.12`
- Flower canonical 源：`vendor/skill-garden/.trellis/0.6/`
- 发布快照：`enhancements/0.6/`
- 当前项目 `.trellis/`、`.agents/`、`.claude/` 只作为 dogfood 输出，不是持久源码所有者。

## Required Patch 预检结果

| Patch 冲突组 | 失败数 | 初步分类 |
|---|---:|---|
| `brainstorm-planning-handoff` | 30 | 多平台副本放大；存在规划批准语义重叠 |
| `trellis-meta-managed-mode-precedence` | 14 | 多数是 selector/baseline 漂移 |
| `inject-workflow-state-shared-runtime` | 9 | whole-file baseline 漂移，且会覆盖上游新能力 |
| `workflow-phase-ownership` | 3 | Flower policy owner 与上游新平台 dispatch 重叠 |
| `session-context-update-boundary` | 2 | imports 与提示文本的 selector 漂移，纯机械重基线 |
| `task-store-write-integrity` | 1 | 上游激活诊断已覆盖旧 Flower Patch，纯机械吸收 |
| `runtime-state-integrity` | 1 | `resolve_active_task` 新参数导致 replacement 失配 |
| `workflow-state-missing-task` | 1 | fallback 清理实现和返回契约重叠 |

总计 61 条失败，归并为 8 组升级处理项；其中既包含真实设计冲突，也包含重复能力和纯机械 selector 漂移。

## 上游版本变化摘要

### 0.6.6

- 新增 Oh My Pi。
- 改进 Pi/OMP context injection、ZCode 布局和 Windows channel。
- task create 增加 `--no-start`、激活诊断和 slug 防护。

### 0.6.7

- 文件写入、状态持久化、卸载和迁移路径安全强化。
- 新增项目本地 Pi session discovery。

### 0.6.8

- 新增 Grok、Kimi。
- Codex 原生 SubagentStart dispatch。
- `trellis platforms --json`、`task.py list/current --json`。
- Pi skill 从 `.pi/skills` 迁到共享 `.agents/skills`。
- Brainstorm 增加显式规划批准。

### 0.6.9

- 新增 Snow。
- sub-agent context 上限和二进制检测。
- `no-trellis` 单轮跳过。
- Codex agent model 配置保留。
- channel trusted context dirs、task meta、journal merge union。

### 0.6.10

- Python 3.9-3.11 兼容。
- Codex hook 截断恢复。
- fallback session 清理修复。

### 0.6.11

- Pi model/thinking 继承。
- Channel 错误传播和 idle timeout。
- UTF-8 hook、polyrepo 扫描上限和 Git probe timeout。
- 平台检测准确性修复。

### 0.6.12

- Pi 并发窗口按原生 session ID 隔离，避免规范化 key 冲突。

## 初步所有权判断

### 应完整吸收

- 文件系统安全、Python 兼容、channel 可靠性。
- context 大小限制、二进制检测、journal merge union。
- 新平台的原生运行时机制。
- Codex SubagentStart、agent model 配置保留。
- polyrepo/Git timeout 和 Pi session isolation。

### 需要语义合并

- Active-task 解析和清理。
- Codex dispatch mode 与 `trellis-route`。
- Workflow Phase 2 和新平台 dispatch。
- Brainstorm final approval 与 Flower task brief。

### 建议继续由 Flower 拥有

- Flower update/self-update 提示和确认链。
- `trellis-route`、`trellis-check-all`、auto-loop 和 untracked flow 的策略所有权。
- 损坏 runtime 不得被当作 missing 的完整性契约。
- `brief.md` 作为最终 planning handoff 的机械门禁。

## 隐性冲突

- `src/constants.js` 缺少 `--omp`、`--grok`、`--kimi`、`--snow`。
- `ENHANCEMENT_SKILL_TARGETS` 仍把 Pi 指向 `.pi/skills`。
- Kimi 共享 `.agents/skills`，但角色 skill 和内置 sub-agent dispatch 需要专门适配。
- OMP、Grok、Snow 具有各自 skill root 或 extension/hook，不能只依赖 `.agents/skills`。
- 当前 whole-file workflow-state 内容缺少 `no-trellis`、ZCode 检测和 Codex `auto` 语义。

## 决策顺序

1. D01 Active-task 状态契约。
2. D02 Codex dispatch 所有权。
3. D03 workflow-state Patch 粒度。
4. D04 Workflow Phase 2 与平台 dispatch。
5. D05 Planning consent 和 brief。
6. D06 Update 边界。
7. D07 Task store 写入事务。
8. D08 平台矩阵和 Pi 迁移。
9. D09 baseline、兼容声明和验证矩阵。

## 已确认决策

### D01 Active-task 状态契约

用户确认采用合并方案：保留 Flower 的损坏状态保护、原子 `fsync` 写入和结构化清理结果，同时完整吸收 Trellis `0.6.12` 的解析参数、新平台 context key、fallback 开关和清理修复。

实现阶段需要重写 `runtime-state-integrity` 与 `workflow-state-missing-task` 的相关 replacement，不能只更新旧 selector。

## D02 历史证据

- 历史任务 `06-16-force-codex-dispatch-sub-agent` 明确决定覆盖用户已有的 `codex.dispatch_mode: inline`。
- 当时的根因是上游缺失配置默认 `inline`，`<codex-mode>inline` 会让模型把 subagent 路由误判为不可执行。
- Flower 随后明确规定：Codex inline 只是默认执行偏好，不是 `trellis-route` 选项过滤器；真实 implement/check 模式由 route runtime、个人偏好或紧邻选择决定。
- Trellis `0.6.12` 已把缺失配置默认改为 `auto`，并通过原生 `SubagentStart` 提供上下文，因此“缺失配置导致误判”的根因已消失。
- 但上游显式 `inline` 还会影响 JSONL seed/readiness；如果 Flower 继续允许 route 在显式 inline 下选择 subagent，就必须继续把 Codex 项目维持在 `auto` 能力基线，或者另行重构 task context 准备逻辑。

## D02 已确认结论

用户确认方案 A：Flower 管理的 Codex 项目统一使用上游正式值 `codex.dispatch_mode: auto` 作为能力基线，实际 inline/subagent 选择继续由 `trellis-route` 独占。

- 旧值 `sub-agent` 只作为上游兼容输入，不再作为 Flower 输出。
- 显式 `inline` 会被 Flower 规范化为 `auto`，因为 Trellis `0.6.12` 会同时据此跳过 subagent JSONL seed/readiness。
- 始终 inline 属于 route 偏好，不属于平台能力开关。

## D03 workflow-state whole-file override

### 当前实现与冲突

- `inject-workflow-state-shared-runtime` 对共享 hook 使用 `selector: whole-file` 和 `operation: replace`，同一份 489 行 `content.py` 覆盖 9 个平台副本。
- 该覆盖承载 Flower 的 `missing_task`、`untracked_flow`、breadcrumb 摘要和 task/untracked/no-task 分支，是此前 stale pointer 重路由设计的实现载体。
- Trellis `0.6.12` 在同一 hook 中新增 ZCode 检测、`no-trellis` 单轮跳过、Codex `auto` 规范化和原生 subagent 提示，并把部分异常捕获从 `BaseException` 收窄为 `Exception`。
- 当前 Flower whole-file 内容不含这些新增能力；直接接受旧 replacement 会覆盖上游修复。预检中的 9 条失败只是同一概念冲突的平台放大。

### 方案 A：拆成局部 required Patch（推荐）

以上游 `0.6.12` hook 为基础，退役 whole-file replacement，把 Flower 行为拆为严格、局部且按顺序执行的 Patch：

- 调整 stale active-task 到 `missing_task` 的映射。
- 注入 `untracked_flow` 读取 helper 与所需 import。
- 扩展 breadcrumb 的 subject label/summary 参数和渲染。
- 仅替换 `main()` 中 task、untracked、no-task 的 Flower 分支。
- Codex bootstrap 或更新提示等其他 Flower 所有内容继续按独立所有权拆分。

每个操作仍使用 required selector 和已知 baseline；未知上游结构继续触发 zero-write，而未触及的上游能力会自然保留。

取舍：一次性重构成本较高，Patch 数量和顺序依赖增加；但未来只有上游修改同一局部语义时才需要重基线，显著降低整文件漂移和误覆盖修复的风险。

### 方案 B：继续 whole-file replacement

手工生成一份合并了 Trellis `0.6.12` 与 Flower 行为的新 `content.py`，并补充新 baseline。

取舍：本次改动最直接、最终文件完全确定；但以后共享 hook 任意变化都要进行完整人工重基线，9 个平台副本继续一起失败，也更容易在更新 baseline 时把已过时的上游实现固化进 Flower。

### 初步建议

推荐方案 A。Flower 的架构定位是上游 Trellis 的增强层；whole-file replacement 已从早期实现便利演变为高耦合 fork，和本次“吸收上游机制、保留 Flower 策略”的升级目标不一致。

### D03 已确认结论

用户确认方案 A：退役 whole-file replacement，把 Flower 的 `missing_task`、untracked、breadcrumb 和主分支行为拆成局部 required Patch。局部 Patch 仍需严格 baseline、顺序和 zero-write 预检。

## D04 Phase 2 所有权与原生平台 dispatch

### 上游 `0.6.12` 变化

上游 `dist/templates/trellis/workflow.md` 扩展了 Phase 2 平台矩阵：

- Codex 通过原生 `SubagentStart` 注入上下文，并保留 child-side pull fallback。
- Snow、ZCode、Pi、Oh My Pi 等平台使用 hook/plugin 或可自动发现的项目 agent。
- Gemini、Qoder、Copilot、Reasonix、Trae、Grok、Kimi Code 使用 pull-based agent 定义。
- Grok 必须使用 `spawn_subagent`，并把 `subagent_type` 设置为 Trellis agent 名称。
- Kimi Code 没有项目级自定义 agent，需要 dispatch 内置 `coder` / `explore`，并携带对应本地 role skill。

这些是平台机制能力，Flower 当前 `trellis-route` 的固定 `Agent({subagent_type: ...})` 表达不足以覆盖所有新平台。

### 与 Flower 的真实语义冲突

- 上游 Active Task Routing 和 Phase 2 仍按静态平台矩阵直接决定 inline/subagent；Flower 已明确由 `trellis-route` 独占执行模式选择。
- 上游 Phase 2.2 的 `trellis-check` 是 workspace-write、自修复检查；Flower 的统一 `trellis-check-all` 默认 audit-only、collect-all，普通 `CHK-*` 必须汇总后由用户一次确认修复范围。
- Flower Phase 2.1 还拥有 auto-loop continuation、pre-check hold、untracked flow 和默认进入 Check-All 的顺序；这些不是上游平台 dispatch 能力可以替代的。
- 预检中的 3 条 `workflow-phase-ownership` 失败对应 Active Task Routing、Phase 2.1 和 Phase 2.2 的上游 section 漂移，不能仅靠补平台名解决。

### 方案 A：策略与平台机制分层（推荐）

继续由 Flower 独占 Phase 2 策略所有权，但完整吸收上游 `0.6.12` 的平台安装产物、agent 定义、hook/context injection 和原生 dispatch 能力：

- Phase 2 只保留门禁、`trellis-route` 指向、Check-All 语义及完成链，不维护静态平台名单。
- `trellis-route` 继续决定逻辑模式，并通过独立、按需加载的平台 dispatch 映射输出当前平台的精确执行方式。
- 上游 agent 的实现角色在语义兼容时直接复用，不由 Flower 重写。
- 上游自修复 `trellis-check` 不得冒充 Flower 的 subagent Check-All；支持只读通用或专用 subagent 的平台使用 Flower audit-only 适配，不具备兼容能力的平台不提供 subagent Check-All，要求改选 inline。
- 对 `workflow-phase-ownership` 的三个 section 使用 `0.6.12` 新 baseline 继续精确 replace，避免把上游静态 direct-dispatch 规则与 Flower route 同时保留。

取舍：需要维护一份较小的平台 dispatch 映射，并为 Check-All 明确各平台是否具备只读 subagent 能力；但策略只有一个 owner，新平台的工具和上下文能力仍由上游提供。

### 方案 B：保留上游 Phase 2 平台矩阵，再局部插入 Flower route

让上游 workflow 继续描述各平台的直接 dispatch，在入口前后插入 `trellis-route`、Check-All 和 Flower completion gate。

取舍：新增平台的文案可以随上游自然更新；但 Phase 2 会同时存在静态平台路由和动态 `trellis-route` 两个 owner，上游自修复 check 与 Flower audit-only check 也需要大量例外覆盖，后续很容易重新出现重复规则和执行歧义。

### 初步建议

推荐方案 A。平台能力应被吸收，但不能反向接管 Flower 已经建立的路由、检查授权和完成链。D04 的升级目标应是“上游提供怎么 dispatch，Flower 决定何时、为何、以哪种检查语义 dispatch”。

### D04 已确认结论

用户确认方案 A：继续由 Flower 独占 Phase 2 策略，由 `trellis-route` 承接平台执行配方，上游负责 agent/hook/context injection 等平台机制。上游自修复 `trellis-check` 不得替代 Flower audit-only Check-All；没有兼容只读 subagent 的平台只能改选 inline Check-All。

## D05 Planning consent 与 Brief 门禁

### 上游 `0.6.12` 变化

上游 Brainstorm 新增 `Non-Negotiable Planning Contract`、Requirement Convergence Gate 和 final planning summary：

- 创建任务前要求 task-creation consent。
- 非平凡任务至少需要一次初始请求后的用户回应。
- 无用户决策残留后生成最终规划摘要并停止。
- 只有用户在后续消息中明确批准最新摘要，才能运行 `task.py start`；规划内容实质变化后必须重新 review。

这比 `0.6.5` 的批准语义更严格，目标与 Flower 的 planning/implementation 隔离一致。

上游没有规定固定 Markdown 模板，但强制 final planning summary 在对话中展示以下栏目：Goal、In Scope、Out of Scope、Acceptance Criteria、Key Decisions、相关 Risks 或 Deferred Items，以及 artifact status。它没有要求把该摘要持久化为单独文件。

### Flower 当前设计

- 高置信复杂实施意图可由 `task_intent.py create` 自动创建、标记 planning task；它只建立可安全 discard 的规划 workspace，不授权实现。
- `trellis-brainstorm` 收敛后必须交给 `trellis-task-brief`，由最新 `prd.md`、`design.md`、`implement.md` 派生 `brief.md` 并在对话完整展示。
- 默认只有用户在 Brief 展示后的后续消息明确确认，才可运行 `task.py start`；普通“开始做”“按建议来”不能复用为最终批准。
- `task.py start` 对 planning task 硬校验 `brief.md` 存在且不早于权威规划产物；它只能证明 handoff 新鲜度，不能伪造真人批准。
- 用户可在当前对话中明确预授权“最终 Brief 展示后直接开始”，但范围扩大、仍有 Open Questions 或新增高风险边界时预授权失效。

本轮最终调整后，Brief 固定栏目是 Goal、Scope、Non-Goals、Key Decisions、Key Context、Acceptance、Next Step，并按需生成 Risks/Deferred Items；它不附加 artifact status。

用户已确认 `Non-Goals` 继续作为独立栏目。原因是它承担防止范围扩张的显式交接边界；虽然语义等同于上游 Out of Scope，但不应为了压缩标题而降低其可见性。

进一步核对现有 `trellis-task-brief` 和任务恢复设计后，`Next Step` 也应继续保留：Brief 的职责包含跨会话、跨 agent 的实施交接，当前 in-progress 重述会从 Brief 指向 `trellis-route(implement)`。该栏目只能保存一跳 owner 指针，不复制 route 或 Phase 2 的完整规则。

### 真实冲突

如果直接叠加 `0.6.12` 与 Flower 现有规则，会出现两个 final review：先批准上游 final planning summary，再生成和批准 Flower Brief。二者表达的是同一次 Phase 1 → Phase 2 转换，双重确认不会增加可机械证明的安全性，只会制造哪个批准有效的歧义。

此外，上游要求显式 task-creation consent，而 Flower 已把可逆、仅 planning 的自动 task 创建视为意图路由机制；如果完全采用上游规则，会重新引入创建复杂任务前的流程询问。

### 方案 A：一个最终 Brief 批准点（推荐）

吸收上游的 Planning Contract、用户决策清单、Requirement Convergence Gate 和“最终摘要后新鲜批准”原则，但把 `brief.md` 定义为 Flower 管理项目中的最终规划摘要载体：

- 高置信复杂实施意图仍可自动创建 planning task；自动创建不等于开工授权，并保留现有安全 discard。
- 用户逐项确认 D01-D09 等内容只批准对应设计选择，不构成 implementation approval。
- Brainstorm 收敛、三件套完成后直接调用 `trellis-task-brief`；不先展示另一个需要批准的通用 final summary。
- 最终 handoff 覆盖上游 final summary 的批准职责，但保持精简：`brief.md` 保留 Goal、Scope、独立 Non-Goals、Key Decisions、Key Context、Acceptance、Next Step，并仅在存在时生成 Risks/Deferred Items；Key Decisions 只提炼影响实施批准的最终选择及其影响，不复制完整决策台账，也不计算或展示 Artifact Status。
- 完整展示最新 Brief 后的明确批准是唯一默认 `task.py start` 授权；规划实质变化后必须刷新 Brief 并重新批准。
- 保留当前窄预授权例外及 `task.py start` 的缺失/过期 Brief 硬门禁。

取舍：Flower 继续维护 Brief 派生层和 start guard；但用户只经历一次最终批准，同时保留跨 agent 交接和规划新鲜度的确定性保护。

### 方案 B：以上游 final summary 替代 Flower Brief

移除 `brief.md` handoff 和 `task.py start` freshness guard，直接采用上游最终摘要及后续批准。

取舍：更贴近上游、Patch 更少；但会失去持久化的多 agent 交接摘要、同回合绕过的最后防线，以及规划产物变更后可机械检测的 freshness gate。

### 方案 C：保留两次最终批准

先走上游 final summary approval，再走 Flower Brief approval。

取舍：实现最机械，但同一次阶段转换需要两次相邻确认，且第一次批准没有独立状态或安全职责，不推荐。

### 初步建议

推荐方案 A。上游 `0.6.12` 新增的是 Flower 已经需要的批准原则，不应变成第二个 Gate；应把它吸收到现有 Task Brief Handoff，由 Brief 作为唯一可见的最终 review 对象。

### D05 已确认结论

用户确认方案 A：保留 planning task 自动创建但不复用为实施授权；上游 final review 原则与 Flower Task Brief Handoff 合并为一个最终批准点。

最终 Brief 结构为 Goal、Scope、独立 Non-Goals、Key Decisions、Key Context、条件性 Risks / Deferred、Acceptance 和一跳 Next Step。逐项 QA 只确认局部决定；Brief 提炼影响实施批准的最终选择，但不复制完整决策台账或附加 Artifact Status，规划实质变化后必须刷新并重新批准。

## D06 Session Context 更新提示 Patch

### 复核结论：不是产品设计冲突

用户质疑成立。对比官方 `0.6.5` 与 `0.6.12` 后，Flower 和上游在这一区域没有新增的所有权或行为冲突：

- `0.6.5` 已经包含完整的 `_get_update_hint()`、session marker、版本比较和 `output_text()` 前置提示。
- Flower 当前 `session-context-update-boundary` 早已明确删除整套原生 Session Context 更新提示，由独立 `flower_update_hook.py` 负责更新检查与用户确认。
- `conflicts.json` 的 `session-context-no-legacy-update-check` 也已把 `flower-update-hook` 声明为 owner，并断言最终文件不含 `_get_update_hint()`、marker helper 和 `trellis --version` 调用。
- `0.6.12` 没有改变上述所有权关系，也没有新增第二条必须合并的更新业务链。

因此，D06 不需要用户在“上游提示”和“Flower 提示”之间重新做产品选择；维持当前 Flower owner 即可。

### 两条预检失败的准确来源

`session-context-update-boundary` 的 2 条失败都是 exact selector 漂移：

1. `session-context-update-imports`
   - `0.6.12` 为 polyrepo 上限警告新增了 `import sys`。
   - 旧 selector 要求 `subprocess` 后直接出现 `Path`，因此不再匹配。
   - 新 content 必须删除更新提示专用的 `os`、`re`、`subprocess` 和 `resolve_context_key`，但保留上游新增且仍被 polyrepo 逻辑使用的 `sys`。
2. `session-context-update-helpers`
   - 上游只把提示尾部从错误的 `run trellis upgrade` 修正为 `run trellis update`。
   - Flower 会删除整个 helper 区域，所以该变化不改变最终行为，只使包含旧文本的 selector 失配。

`session-context-update-constants` 与 `session-context-update-output` 的目标语义没有变化。这里不应新增状态归一化、复用上游 marker 或重构 Flower self-check；那些都超出升级所需范围。

### 实施归类

D06 降级为纯机械重基线项：

- 保留 Flower 独立更新 hook、确认链、Plugin 重放和更新后 Push 链，行为不变。
- 更新 imports selector/content，保留 `sys`。
- 更新 helpers selector 以匹配 `run trellis update` 后继续移除该区域。
- 保留 `session-context-no-legacy-update-check` 冲突断言。
- 验证最终 `session_context.py` 仍包含上游 polyrepo/Git timeout 修复，但不包含原生更新提示。

这项不计为需要用户 QA 的设计分支，只计入 61 条预检失败中的机械修复与回归验证。

## D07 Task store 写入完整性

### 复核结论：不是新的事务设计冲突

`task-store-write-integrity` 只有 `task-create-active-warning` 一条 operation 在 `0.6.12` 失配。原因是上游已经把原先静默吞掉的激活异常改成了更完整的分阶段诊断，并新增 `--no-start`：

- import 失败、context 解析失败、pointer 持久化失败和空返回分别给出 warning。
- 成功时输出激活任务路径与 source。
- 无 session identity 仍作为正常的 CLI 场景静默处理。

这完整覆盖并优于 Flower 旧 Patch 的单条 warning，因此该 operation 应退役，直接保留上游实现。

上游 `0.6.12` 并未覆盖 Flower 其余写入完整性契约：初始 `task.json`、archive 状态、set-* 命令以及 parent/child 双文件写仍有多处忽略 `write_json()` 返回值，也没有跨文件补偿。因此以下 Flower 行为仍需保留：

- 初始写失败时清理本轮创建的任务目录。
- parent/child 双向关系写入失败时恢复双方快照，并在补偿不完整时显式报出人工恢复路径。
- archive、set-branch、set-base-branch、set-scope 写失败必须返回非零，不能输出成功。
- decision log 损坏继续 fail closed。

`0.6.12` 新增 `set-meta`，它同样忽略 `write_json()` 结果，应按现有 set-* 规则新增机械 Patch 和失败测试。

D07 因此不需要产品 QA：吸收上游激活诊断、退役重复 warning operation，同时把既有 Flower 写入完整性规则扩展到 `set-meta`。

## D08 新平台矩阵与 Pi Skill 迁移

### 复核结论：由 D04 已确认边界直接推导

D04 已确认完整吸收 `0.6.12` 的平台安装产物、agent 定义、hook/context injection 和原生 dispatch 能力，因此 D08 不再存在“是否支持新平台”的独立产品选择。实现映射由上游目录契约决定：

- Pi：强化 Skill 从 `.pi/skills` 迁到共享 `.agents/skills`，与 Codex/Gemini/Kimi 使用 byte-identical neutral 内容。
- Oh My Pi：`.omp/skills`，并保留上游 extension/hook 能力。
- Grok：`.grok/skills`，属于无 hook 的 pull-based 平台。
- Kimi：共享工作流 Skill 位于 `.agents/skills`；Kimi 私有入口与 agent role 继续由上游放在 `.kimi-code/skills`。
- Snow：`.snow/skills`，并使用上游 `.snow/hooks` 与项目 agent discovery。

机械改动包括：

- `PLATFORM_FLAGS` 增加 `--omp`、`--grok`、`--kimi`、`--snow`，避免用户显式选择新平台时 Flower 误补 `--claude`。
- `ENHANCEMENT_SKILL_TARGETS` 迁移 Pi，并增加 OMP/Grok/Kimi/Snow 对应目标；共享 root 必须合并平台声明，不能重复写出不同字节。
- fixture、Patch target 与能力矩阵覆盖四个新平台；只在上游平台能力允许的地方配置 hook，不为 Grok/Kimi 伪造项目级 hook。
- `trellis-route` 按 D04 输出各平台真实 dispatch 配方，Kimi 使用内置 subagent，Grok 使用其原生 `spawn_subagent` 约束。

D08 只需要实现验证，不需要再次询问用户。

## D09 兼容声明与验证目标

### 唯一剩余产品选择

当前 `compatibility.json` 声明 `compatibleLine=0.6`、`testedVersions=["0.6.5"]`、未测试 patch 版本只 warning。升级后必须至少把 `0.6.12` 作为 tested version，但是否继续让新版 Flower 承诺 `0.6.5` 仍是一个真实范围选择。

### 方案 A：新版只承诺 `0.6.12`（推荐）

- `testedVersions` 改为只包含 `0.6.12`。
- 保留 `compatibleLine=0.6` 和 required Patch 的 fail-closed 预检；其它 0.6 patch 版本不宣称已测试。
- 正常 `flower-trellis update/self-update` 仍支持从旧项目升级，因为流程会先把 Trellis 项目基线更新到捆绑的 `0.6.12`，再重放新版 Patch。
- 不保证新版 Flower 的 `--enhance-only` 可直接作用于仍停留在 `0.6.5` 的项目。

取舍：升级实现和验证矩阵最清晰，但新版 Flower 不再对旧 Trellis 基线提供独立运行承诺。

### 方案 B：同时承诺 `0.6.5` 与 `0.6.12`

- 两个版本都保留在 `testedVersions`。
- 所有 required Patch 必须能在两份 pinned fixture 上完整预检并生成正确最终产物。
- 对 literal selector 已变化的区域需要多版本 operation、兼容 selector 或单独 Patch 目录，不能只把旧版本写进声明。

取舍：允许新版 Flower 在未升级 Trellis 的项目上继续 enhance-only；但会显著扩大 Patch 维护和回归矩阵，并把本次升级从单目标重基线变成双基线兼容工程。

### 初步建议

推荐方案 A。用户明确把 `0.6.12` 作为升级目标；旧版 Flower 已负责旧基线，新的 Flower 版本应保证升级路径，而不必同时维护升级前后的两套 exact selector。

### D09 已确认结论

用户确认方案 A，并指出 npm 版本控制已提供主要隔离。代码复核确认：

- `flower-trellis` 对 `@mindfoldhq/trellis` 使用精确版本依赖。
- `trellisVersion()` 从当前 Flower 包内依赖读取捆绑版本。
- `syncGlobalTrellis()` 把全局 Trellis 同步到该精确版本。
- `flower-trellis update` 随后运行项目 `trellis update` 并重放 Plugin。
- `self-update` 安装新 Flower 后调用新版本的项目 update 链。

因此新版只把 `0.6.12` 放入 `testedVersions` 是合理边界。npm pin 保护正常升级路径；Patch compatibility 和 required preflight 继续保护手动混用版本、`--enhance-only` 及损坏安装等非标准入口。
