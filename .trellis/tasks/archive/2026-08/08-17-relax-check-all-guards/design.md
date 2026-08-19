# Technical Design

## Overview

本任务在现有 Check-All 问题模型和完成链内原位替换四组判据，不新增 finding 通道、持久化状态或独立路由器。核心做法是把“语义是否明确”“验证属于哪个阶段”和“本次重检需要多大范围”作为判断依据，替代固定口令、统一阻断和跨轮 full 锁定。

## Source Of Truth

作者源位于：

- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-check-all/`
- `vendor/skill-garden/.trellis/0.6/.claude/skills/trellis-check-all/`
- `vendor/skill-garden/.trellis/0.6/.agents/skills/trellis-route/references/check-all-agent-body.md`
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/phase-ownership/phase-2-check-content.md`

必要时同步调整 Push 的完成链摘要和输出模板。父仓 `.trellis/spec/flower-trellis/cli/enhancements-model.md` 保存长期契约；`enhancements/0.6`、compiled targets 与当前项目 dogfood 均从作者源生成。

## Risk Acceptance Contract

风险接受以当前可见报告和用户语义为边界：

```text
接受当前报告全部风险 / 全部接受 / 这些都接受
  -> 接受当前报告全部 CHK/FBK，包括 P0

接受 CHK-001,FBK-002 / 接受前两个问题
  -> 只接受能唯一定位的子集

接受了 / 都接受（存在多版竞争报告或指向不清）
  -> 停止并询问一次范围
```

不再设置 P0 固定 ID 口令特例。接受仍随受影响代码、契约、验证结果、问题内容或严重度变化而失效；这是防止旧授权漂移的真正安全边界。

## Verification Phase Contract

验证缺口分成两类：

| 类型 | 判定 | Check-All 结论 | 完成链 |
| --- | --- | --- | --- |
| `部分验证` | 当前代码结论所必需，提交前原则上可完成，但证据缺失或未执行 | 不通过/部分验证 | 阻断 |
| `上线后验证` | 只有部署后、生产环境或外部系统中才能安全执行 | 在未覆盖与风险中展示，不伪报执行 | 不阻断 |

`上线后验证` 不是新的维度状态，也不是风险接受。它是当前检查范围之外、已有发布流程负责的后续动作：

- 标准报告在“未覆盖与风险”使用 `[上线后验证]` 标签，写明动作、环境、责任边界和预期结果。
- strict pass 表示提交前检查范围严格通过；允许同时存在已明确登记的上线后验证。
- direct Git、Update-Spec 与 Push 不因上线后验证停顿，但 Push 风险摘要继续展示这些事项。
- finish-work 的 `trellis-release audit-current` 继续从任务材料、检查证据和 Git 影响面生成或核对 `release.md`。
- 生产或外部系统操作仍需独立授权，Check-All 只记录，不执行。

防止逃生通道：如果验证可通过本地 fixture、测试环境、静态契约或无副作用命令完成，它仍属于当前检查范围；只有验证本质上依赖部署完成或真实外部状态才进入上线后验证。

## Recheck Depth Contract

区分单次执行与跨轮修复：

```text
同一次 Check-All：light 命中 hard-full -> full，之后不降级

full 报告 -> 局部修复 -> 下一次 Check-All：
  范围闭合 + 原 finding 可定向验证 + 无 hard-full -> 可 light 重检
  行为 hard-full / 范围不明 / 用户显式 full           -> full

准备结束 Phase 2.2 或进入 Git 完成链：
  原 full 证据仍适用 + 后续 diff 已完整定向验证 -> 复用证据完成
  范围扩大 / 契约或基线变化 / 未知 dirty / 证据失效 -> full
```

因此从 `depth-routing.md` 移除“任何既有 full finding 重检都 hard-full”的跨轮锁定，保留单次 light->full 单向升级。`reporting-and-disposition.md` 不再规定“上次 full 则本次最小 full”，workflow 也不再因进入提交链无条件要求最终 Full，而是核对原证据是否仍覆盖当前 diff。

## Verification Evidence Contract

Light 与 Full 统一使用“充分证据”而非“必须存在自动化测试文件”：

- 自动化测试优先。
- 可重复的手动步骤、静态检查、定向命令或真实契约核对可以满足验证要求。
- 项目 spec、风险等级或回归概率明确要求自动化覆盖时，缺失测试仍为 `CHK-*`。
- 无任何充分证据、已有测试未运行、验证失败或关键路径无法复现时记录 finding。

现有 Verification Tests dimension 保留，只替换其准入文字和正反断言，不新增维度。

## Downstream Consistency

- `fallback-findings.md` 与 `reporting-and-disposition.md` 同步风险接受和验证阶段语义。
- `light-profile.md` / `full-profile.md` 同步充分证据口径。
- route agent body 明确返回 `上线后验证`，且不得把它误标为阻断型部分验证。
- workflow Phase 2 只保留跨阶段摘要：部分验证阻断，上线后验证非阻断但必须交接。
- Push 保留上线后验证可见性，不把它升级为 finding，也不丢失到提交计划之外。
- validated auto-loop 可在无 CHK/FBK、无阻断型部分验证时 `record ok`，摘要包含上线后验证事项；不得代表用户执行这些操作。

## Testing Strategy

- 风险接受：全部接受覆盖 P0；部分接受需唯一定位；报告/diff 漂移后失效；固定口令断言删除。
- 验证阶段：生产/外部验收非阻断；本地可执行但缺失的验证继续阻断；auto-loop 与 direct Git 消费一致。
- 重检深度：单次升级不降级；跨轮局部修复可 light；完成/提交不单独触发 full，范围扩大或证据失效时仍 full。
- 验证证据：自动化、可重复手动/静态证据通过；无充分证据或项目明确要求自动化时产生 CHK。
- 分发：canonical agents/claude、snapshot、compiled targets、dogfood 与长期 spec 一致。

## Risks And Rollback

- 生产验证被误判为非阻断：通过“本质依赖部署/真实外部状态”硬条件和反向测试控制。
- light 重检漏掉扩散影响：只有范围、原 finding、直接引用与回归路径均可穷举时允许；一旦范围扩大、出现未知 dirty 或原证据失效就升级 full。
- 手动验证质量不稳定：要求步骤可重复、预期明确并覆盖关键假设；模糊描述不构成证据。
- 回滚时恢复 canonical 规则和测试，再重新生成 compiled targets、snapshot 与 dogfood，禁止只回滚派生产物。
