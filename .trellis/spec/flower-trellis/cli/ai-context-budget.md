# AI Context Budget

> 控制 Trellis 最终工作流、最终技能入口和运行时注入上下文的总量；默认告警，严格模式才阻断 high-warning。

---

## Scope / Trigger

以下改动必须读取本规范并运行预算 checker：

- 修改 `.trellis/workflow.md` 或会 Patch 到 workflow hub/state 的内容。
- 修改 Update-Spec、Finish-Work、Auto-Loop 等会被完整加载的最终 skill/command body。
- 修改 `get_context.py --mode phase`、SessionStart hook、workflow-state hook 或 task-status 注入。
- 把长流程从 skill/helper 移入高频 prompt，或在多个层重复同一规则。
- 调整任何 target、review ceiling、baseline 或总量公式。

这里控制 Trellis AI control-plane。业务 PRD、design、implement 和 package spec 按需读取，不把它们全部常驻 SessionStart。

## Final-Output Principle

预算必须测 pinned full 最终文件和真实运行输出，禁止把 Patch source 当成最终上下文：

- workflow：读取当前 `vendor/skill-garden/compiled-targets/<version>/full/targets/.trellis/workflow.md`。
- workflow control：从 compiled full workflow 的 `## Phase Index` 到 `## Phase 1: Plan`。
- state：从 compiled full workflow 动态提取全部 `[workflow-state:*]` body。
- Update-Spec/Finish-Work：读取 compiled full 中实际存在的最终 `.agents`、`.claude/skills`、`.claude/commands` 入口。
- Auto-Loop：该 skill 不是 Patch target，读取 `vendor/skill-garden/.trellis/0.6` 下直接铺设的 canonical `.agents/.claude` 入口；源、快照和 dogfood 一致性由同步测试单独保证。
- Phase summary：真实运行 `python3 ./.trellis/scripts/get_context.py --mode phase`。
- SessionStart：用隔离临时 fixture 调用真实 `.codex/hooks/session-start.py`，读取 `additionalContext`。

Patch 的 `content.md`、`common-content.md`、`subagent-content.md` 只是构建输入。直接测它们会漏掉 frontmatter、上游保留段、marker、结构拼接和平台差异，因此不构成预算证据。

## Output Contract

```bash
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
```

每个对象输出：

- `status`：`ok | warn | high-warning`
- `name`
- `actual bytes`
- `lines`
- `target`
- `review ceiling`
- 已登记 baseline 时的 `baseline delta`

UTF-8 bytes 是确定性指标，行数只用于诊断。模型 tokenizer 会变化，不作为可复现门禁。

## Layer Ownership

| 层 | 应保留 | 禁止 |
|---|---|---|
| workflow hub | 跨阶段门禁、短指向 | helper schema、完整交互模板、重复 skill 流程、覆盖下层的优先级声明 |
| workflow-state | 当前状态的一跳动作、关键禁止事项 | 复制 hub 长段、解析 runtime/JSON/Git |
| workflow body | 官方阶段结构和低频 walkthrough | 与 hub 同义的第二份完整规则 |
| skill/command | 完整语义流程、选项、交互边界 | 手工实现可确定脚本逻辑 |
| helper | 解析、验证、状态读写、错误矩阵 | 产品意图推断和长 prompt |
| SessionStart | 当前状态、精简 workflow summary、spec index | 全 workflow、全 task artifacts、重复 breadcrumb |

同一规则确需跨层出现时，高频层只保留一句边界和权威入口。默认禁止“旧规则保留 + 新高优先级段继续追加”。

## Budget Table

| 最终测量对象 | Target | Review ceiling |
|---|---:|---:|
| 完整 `.trellis/workflow.md` | 60 KiB | 64 KiB |
| workflow control section | 28 KiB | 32 KiB |
| 单个最终 workflow-state body | 3 KiB | 4 KiB |
| 全部最终 workflow-state body 合计 | 12 KiB | 14 KiB |
| 单个最终 Update-Spec 入口 | 16 KiB | 18 KiB |
| 单个最终 Finish-Work 入口 | 10 KiB | 12 KiB |
| 单个最终 Auto-Loop 入口 | 16 KiB | 18 KiB |
| Phase summary | 18 KiB | 20 KiB |
| SessionStart `additionalContext` | 18 KiB | 20 KiB |
| control-context-total | 116 KiB | 128 KiB |

`control-context-total` 是控制面总体积审计，不声称这些内容会在单次 prompt 中同时出现。公式固定为：

```text
完整 workflow
+ 最大 Update-Spec 最终入口
+ 最大 Finish-Work 最终入口
+ Phase summary
+ SessionStart additionalContext
```

修改公式必须更新 checker、基线和本规范，不能只调整展示文本。

## Warning Policy

- `actual <= target`：`ok`。
- `target < actual <= review ceiling`：`warn`，评审说明增长来源，退出成功。
- `actual > review ceiling`：`high-warning`，默认仍退出成功。
- 测量失败、fixture 损坏、最终目标缺失或输出不可解析：结构性错误，默认失败。
- `--strict` 仅把 `high-warning` 转为非零退出，供发布审计按需使用。

大小默认不作为 `npm test` 硬门禁，这是产品决策。warning 必须打印，禁止静默吞掉；也禁止只为消除 warning 调高阈值。

## Baseline

Skill-Garden 代表性最终入口基线（`.agents` + `.claude`，2026-07-24；target/review ceiling 未调整）：

| 对象 | Lines | Bytes | 状态 |
|---|---:|---:|---|
| 完整 workflow | 710 | 46,750 | ok |
| workflow control | 139 | 12,243 | ok |
| 全部最终 state body 合计 | 48 | 7,261 | ok |
| 最大 Update-Spec 最终入口 | 386 | 13,899 | ok |
| 最大 Finish-Work 最终入口 | 93 | 4,556 | ok |
| 最大 Auto-Loop 最终入口 | 220 | 15,600 | ok |
| Phase summary | 173 | 12,892 | ok |
| SessionStart | 172 | 12,300 | ok |
| control-context-total | - | 90,397 | ok |

Patch 生成的静态最终入口读取 Skill-Garden `all-platforms` canonical compiled full target；预算只选取
`.trellis`、共享 `.agents` 和 `.claude` 的代表性最终入口，不把其它平台的等价投影重复累加。
直接铺设的 Auto-Loop 读取 canonical variant skill。Flower 双 catalog 全平台 fixture 继续只做临时
集成验证，不参与预算重复计数。target/review ceiling 未提高，默认和 strict 仍只有超过 review
ceiling 才由 strict 阻断。

## Change Review

体量优化先做能力守恒，不以删除审计维度、风险门禁或失败关闭语义换取字节下降。修改前必须列出
受保护能力及其现有断言，再按固定顺序压缩：

```text
protected capabilities:
  审计维度与 finding 分类
  行为性 hard-full 与未知影响 fallback-full
  light -> full 单向升级
  strict pass 的阻断语义

optimization order:
  replace/remove 重复规则
  用行为契约信号替换载体或主题域判据
  将低频细则改为候选命中后条件加载
  下游消费者收敛为一跳摘要和权威入口
```

新增或压缩高频内容前依次检查：

1. 哪些能力必须保持，分别由哪个正向和反向断言证明？
2. 能否通过 Patch `replace/remove` 删除旧规则，而不是追加？
3. 能否把低频类型矩阵、证据细则或例外说明改为条件加载？
4. 能否只放在 skill/helper，由 hub/state 保留一句指向？
5. Phase summary 和 SessionStart 是否都会携带它，造成重复成本？
6. 最终文件的 actual/delta/status、专项默认必读集合和 `control-context-total` 是什么？

若只有删除 hard-full、fallback-full、finding 分类、升级门禁或 strict-pass 阻断才能满足预算，停止修改并重新设计；
light 命中增加只能来自载体误判消除和范围可闭合，不能来自真实行为风险门禁减少。

典型职责边界：

- hub：只保存 auto-loop 优先、interactive stop、Update-Spec → Push 去向等跨阶段边界。
- in_progress state：保存一跳动作，不复制 check depth、Update-Spec 三态或 report 模板。
- Check-All skill：入口只保存范围确认、requested/effective depth 路由、profile 引用和最终分流；light/full 详细检查清单、文档漂移自修和报告模板放在 `references/`，按实际 `effective_depth` 与输出阶段再加载，避免 `auto` 被默认 full 提示词带偏。
- Update-Spec 最终入口：保存 `no-op | written | needs-review`、证据顺序、最小写入和自检全文。
- auto-loop runner/skill：保存确定性 state/record 字段和命令签名。
- Auto-Loop 最终入口独立计量，不加入 `control-context-total`；manifest schema、Git 解析和错误矩阵下沉 runner/helper，skill 只保留语义边界和 action 调度。

调整 target/review ceiling 必须同时提交：增长原因、旧/新最终实际值、去重仍无法解决的证据、checker 常量和本预算表。禁止通过调高阈值掩盖重复内容。

## Validation Matrix

| 条件 | 结果 |
|---|---|
| 某最终对象超过 target | warning，默认检查继续 |
| 某最终对象超过 review ceiling | high-warning；默认继续，strict 失败 |
| Patch source 很小但最终入口超限 | 按最终入口告警，不采信 source 大小 |
| SessionStart 无 JSON 或无 additionalContext | 结构错误，失败 |
| workflow/state 或三类最终 skill 入口全部缺失 | 结构错误，失败 |
| 项目存在自定义 workflow-state | 动态计入 state 与 states-total |
| 新规则复制到 hub/state/skill | 评审阻断，先去重 |
| 只提高 ceiling 以消除 warning | 评审阻断 |
| 默认必读字节不增且受保护能力断言全部通过 | 通过；体量控制没有削弱能力 |
| 字节下降但删除了行为性 full、fallback-full 或 strict-pass 反向断言 | 评审阻断；不能证明能力守恒 |
| 低频细则只在候选命中后加载 | 通过；单独计量该文件，不加入默认集合 |
| light 增加来自移除载体型 hard-full，行为性 hard-full 仍覆盖 | 通过 |
| light 增加来自未知影响不再 fallback-full 或风险门禁减少 | 失败 |

## Tests Required

```bash
npm test
node scripts/check-ai-context-budget.mjs
node scripts/check-ai-context-budget.mjs --strict
```

必须验证：

- 默认模式在 warn/high-warning 时退出 0。
- strict 只在 high-warning 时退出非 0。
- 结构性测量错误始终非 0。
- SessionStart fixture 返回非空 `additionalContext`。
- state 从最终 workflow 动态枚举，不写死文件数量。
- Update-Spec/Finish-Work 从 compiled final 平台入口测量，不读取 Patch content；Auto-Loop 从直接铺设的 canonical variant skill 测量。
- control-context-total 使用固定公式和最大平台入口。
- 专项 skill 测试同时固定默认必读字节基线与受保护能力断言；不能只测文件变小。
- 条件加载 reference 单独计量，并断言主入口没有复制其低频类型矩阵或证据细则。
- 深度路由必须有反向用例：载体名称不触发 full，真实行为契约和未知影响仍触发 full/fallback-full。

## Wrong vs Correct

**Wrong**：只测 `overrides/patches/**/content.md`，因为它比最终入口更容易读取。

**Correct**：应用 Patch 后读取最终 skill/workflow，并用真实 Phase/SessionStart 命令测量运行输出。

**Wrong**：每出现一个例外，就在 hub、两个 state 和 skill 各复制完整说明。

**Correct**：helper 保存确定性逻辑，skill 保存完整语义，hub/state 只保留必须高频出现的一句门禁。

**Wrong**：预算 warning 出现后直接提高 review ceiling。

**Correct**：先看最终 delta 和总量，删除或替换重复正文；确有不可压缩的新门禁时再记录理由和新基线。

**Wrong**：为让 Skill 变短，删除 hard-full、FBK 证据或 strict-pass 约束，只保留“按风险判断”的概括句。

**Correct**：保留高频决策所需的行为门禁，把低频矩阵条件加载；同时用字节基线和正反场景测试证明
入口更小、light 更稳定，但 full、fallback 和 strict pass 能力没有减少。
