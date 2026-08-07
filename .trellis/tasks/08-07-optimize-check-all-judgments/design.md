# Technical Design

## Overview

本任务只调整 Check-All 的判断契约，不新增独立 router、finding 通道或报告模型。设计原则是：用更短、更可判定的行为规则替换现有主题域规则；把分类与证据状态分离；把低频注释事实细则下沉到条件加载 reference，保证默认检查上下文不增长。

## Source Of Truth

真实源位于：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/`
- 必要的 route agent 与 workflow Phase 2 消费者位于同一 variant 下。

派生产物包括：

- `enhancements/0.6/`
- `vendor/skill-garden/compiled-targets/`
- 当前项目 `.agents/`、`.claude/` 和适用 workflow/agent dogfood 副本。

修改顺序固定为 canonical 源、compiled targets、发布快照、当前 dogfood。派生产物不得成为手工设计源。

## Context Loading And Budget

### 默认必读集合

Check-All canonical `.agents` 当前基线：

| 文件 | UTF-8 bytes |
| --- | ---: |
| `SKILL.md` | 7,916 |
| `references/depth-routing.md` | 4,834 |
| `references/fallback-findings.md` | 4,677 |
| `references/document-drift-auto-remediation.md` | 5,035 |
| `references/reporting-and-disposition.md` | 17,234 |
| 合计 | 39,696 |

新增专项测试固定验证：

- 主 `SKILL.md` 不超过 7,916 bytes；
- 上述默认必读集合合计不超过 39,696 bytes；
- `.agents` 与 `.claude` 对应文件逐字节一致；
- 新增注释细则单独报告体量，不计入默认必读集合，因为只有发现候选后才读取。

### 条件加载

新增 `references/code-comment-auto-remediation.md`，只保存源码注释候选的允许项、禁止项、应用位置和验证规则。`document-drift-auto-remediation.md` 只保留一条条件路由：发现可唯一验证的源码注释事实候选时才读取该文件。

不修改统一报告模板结构。注释修复继续使用现有 `DOC-*` 自动修复区，FBK 验证不足继续使用现有验证字段、维度状态和未覆盖风险。

## Depth Routing Contract

### 决策顺序

```text
requested=full                                  -> full
命中行为性 hard-full                            -> full
requested=light 且无行为性 hard-full            -> light
requested=auto 且范围闭合、验证可定向            -> light
其它情况                                        -> full / fallback-full
```

light 执行中出现影响面扩大或关键验证缺口时单向升级 full；已有 full 修复/重检链不得降级。

### 行为性 hard-full

只保留会改变实际契约或让影响面无法闭合的信号：

1. 公共 API、CLI、schema、持久化状态、协议字段、缓存或历史数据兼容发生行为变化。
2. 权限、安全、资金、并发、时序、状态机、迁移、回滚、发布或 Git 控制门禁发生行为变化。
3. 改动跨越独立行为边界，或直接引用点、状态传播和回归路径无法完整列出。
4. 正在重检既有 full finding，或 light 检查中发现未知范围与关键验证缺口。

workflow、skill、command、hook、安装、发布和生成快照只描述载体或主题域，不再单独构成 hard-full。若这些文件改变执行顺序、门禁、状态、命令签名或错误路径，仍按上面的行为信号进入 full。

### Light Eligibility

light 需要同时证明：

1. 变更可归属于一个闭合的语义范围；同一真实源的多个机械投影仍算一个范围。
2. 未命中行为性 hard-full。
3. 受影响规划条目、直接引用点和回归路径可穷举。
4. 存在定向验证，或改动仅为无行为风险的注释、错别字、排版、解释文字、示例和机械同步。
5. 不在 full 修复/重检链中。

`check_profile.reasons` 复用现有字段，写具体行为信号、无法闭合项或 light 证据，不新增 reason schema。

## FBK Classification Contract

### 分类阶段

先判断根因是否位于保护路径：fail-closed、异常输入、失败降级、防御性权限或数据保护、容错、故障可观测性。正常输入主路径在移除该保护后仍成立时，根因优先属于 `FBK-*`；正常路径本身错误时属于 `CHK-*`。

### 硬准入

生成 `FBK-*` 只要求：

1. 可定位到具体保护边界、文件、契约或数据流位置。
2. 存在由代码、契约、配置或依赖行为证明的具体可达异常场景，不要求已经实际发生。
3. 有证据证明当前保护缺失、错误、过度降级或可绕过。

### 报告完整度

保护收益和验证方式继续出现在现有报告字段中，但不决定 FBK 分类：

- 能执行验证时给出并运行定向测试、命令、故障注入或手工步骤。
- 缺少环境、工具或权限时，`验证` 明确写出缺失条件，相关维度标记 `部分验证` 或进入未覆盖风险。
- 部分验证继续阻断 strict pass，但 finding 保留稳定 `FBK-*` ID。

没有具体触发路径的泛化健壮性建议、纯风格偏好和主观重构建议仍不报告。

## Code Comment Auto Remediation

### Candidate

`DOC-*` 新增源码注释事实子类型。候选分为两组：

- 机械引用：符号名、路径、URL、版本、配置键和命令名等可直接替换的引用漂移。
- 局部实现事实：内部常量值、默认值、重试次数、超时时间、内部组件名称和已确定的内部实现机制。

机械引用必须由当前 diff 或已读取仓库事实唯一证明。局部实现事实还必须由本轮 diff 与任务规划、测试结果或其它已读取权威证据共同证明底层变化是有意的，不能只因代码和注释不一致就假定代码正确。

### Exclusions

以下内容不得自动修复：

- 公共 API 行为、契约、约束、原因、业务语义或安全边界；
- 公共 API 的 Javadoc/docstring，包括摘要、参数、返回、异常和废弃语义；
- lint/type-ignore、pragma、构建标签、shebang 和其它工具指令；
- license、copyright、TODO、FIXME、HACK；
- doctest、可执行示例或会被工具消费的注释；
- 无法唯一判断代码与注释谁正确的分歧。

自动修复只替换目标事实片段，不整句润色、不删除注释、不调整注释位置，也不顺带修改其它表达。

### Application Position

- inline interactive：主会话审阅候选并应用。
- subagent interactive：subagent 只返回候选，主会话审阅并应用。
- inline validated auto-loop：主会话审阅候选并应用。
- subagent validated auto-loop：subagent 只返回候选，主会话审阅并应用。

源码注释变化不传 `--doc-remediation-file`；该 runner 参数继续只处理任务 `implement.md` / `brief.md`。

### Verification

应用后必须：

1. 重读修改点和最终 Git diff，确认只改变目标注释文本，缩进、注释形式和可执行代码不变。
2. 重新计算实际范围，确认原 `check_profile` 仍成立；范围扩大时升级 full。
3. 重跑受影响的定向 lint、typecheck、测试或静态验证。
4. 把修复和验证结果写入现有 `DOC-*` 自动修复区；失败或无法唯一判断时转普通 finding。

validated auto-loop 只有在最终无剩余 `CHK-*` / `FBK-*`、无阻塞和无部分验证时才能 `record ok`。

## Downstream Consistency

以下消费者只保留一跳摘要，不复制完整规则：

- light/full profile：消费新 depth 与 FBK 契约。
- route 的专用 Check-All agent body：继续声明 audit-only，并返回注释 `DOC-*` 候选和证据不足的 `FBK-*`。
- workflow Phase 2 Check-All ownership 摘要：只说明低风险事实漂移由 Check-All owner 处理，不展开注释白名单。
- reporting/disposition：原则上不改结构；只有现有文字明确绑定“五项严格准入”时做最小替换。

## Testing Strategy

### Depth

- skill 错别字、workflow 解释文字、机械投影同步、局部行为加定向测试：light。
- skill 门禁顺序、hook 状态流转、CLI/持久化契约、未知影响：full。
- 显式 light 命中行为 hard-full 时升级；full 重检不降级。

### FBK

- 静态可达但未运行复现的保护缺口仍生成 FBK。
- 缺少验证环境时保留 FBK ID，并显示部分验证。
- 主路径错误仍为 CHK；泛化建议不报告。

### Comment Remediation

- 允许机械引用和有双重证据的局部实现事实更新。
- 局部常量、重试次数和内部实现机制只有在本轮 diff 与规划/测试共同证明有意变化时才能修复。
- 每类禁止注释都有反例。
- subagent 只返回候选，两个主会话上下文都可落地。
- 修复后必须重新核对 diff、画像和验证；源码注释不得进入 runner 文档重绑定参数。

### Distribution And Budget

- canonical agents/claude parity。
- canonical、snapshot、dogfood parity。
- compiled targets 零漂移。
- Check-All 专项字节预算、项目默认预算和 strict 预算均通过。

## Risks And Rollback

- light 误判风险：未知行为影响继续 fail-closed 到 full，light 运行中保留单向升级。
- 注释误修风险：事实白名单、双重证据、语义黑名单、片段级替换、主会话复核和最终 diff 验证共同限制；不确定时不修。
- FBK 噪声风险：具体位置、可达场景和缺口证据仍是硬门槛。
- 上下文膨胀风险：专项字节基线阻断默认必读集合增长，低频细则条件加载。
- 分发漂移风险：只编辑 canonical 源，派生产物统一重建；回滚时恢复 canonical 文件并重新生成全部投影。
