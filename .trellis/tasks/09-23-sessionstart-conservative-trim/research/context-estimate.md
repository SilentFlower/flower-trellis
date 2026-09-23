# 开场注入估算与恢复线索

## Evidence Status

- 日期：2026-09-23；来源为本会话的实际只读检查、真实预算脚本和内存文案替换估算。
- 首次建档时根仓 HEAD 为 `0991929`，工作区包含另一窗口的大量未提交变更，因此当时数字只作为候选估算。
- 延期条件满足后已在根仓 `464e0ed`、Skill-Garden `5de4d9c` 上重新测量；两仓均与各自
  `origin/main` 对齐，产品代码无未提交变更。当前未跟踪内容仅为本任务与既有遥测路线图的规划产物。

## Measurement

- 使用 `scripts/check-ai-context-budget.mjs` 导出的 `collectAiContextMetrics()` 重新采集隔离 fixture 的真实 SessionStart 输出。
- 读取实际 workflow 和 Codex hook，确认每个待替换段落唯一匹配；仅在内存中计算原文与候选文案的 UTF-8 字节差。
- 测量范围为 Trellis 的 `state / rules / stages` 三段，不包括宿主全部系统指令、技能目录、任务产物或后续工具输出。
- 平台派发候选文字保持英文，与目标原文一致；空白整理和最终文案可能使结果小幅变化。

| 选定改动 | 原文 B | 候选 B | 预计减少 B |
|---|---:|---:|---:|
| ready 提示 | 104 | 0 | 104 |
| Guardrails 中 PRD-only 重复说明 | 92 | 0 | 92 |
| Phase 1.3 平台列表 | 247 | 123 | 124 |
| Codex 派发说明 | 642 | 339 | 303 |
| 3.1 编号历史解释 | 159 | 0 | 159 |
| 常驻更新处理顺序 | 140 | 0 | 140 |
| 常驻 GC 机制介绍 | 167 | 0 | 167 |
| 合计 | 1,551 | 462 | 1,089 |

| 固定场景 | 修改前实测 B | 修改后估算 B | 预计减少 |
|---|---:|---:|---:|
| Codex＋Astra，startup / clear / compact | 19,177 | 18,088 | 5.68% |
| Codex，其他模型或 Astra 提醒关闭 | 17,165 | 16,076 | 6.34% |

以上均为无活动任务、未触发更新的同口径 fixture。触发更新时，需要在动态块补回处理顺序，因此该次净节省预计略少；更新场景没有测得精确修改后数值。没有将字节数换算为模型 token 或费用。

恢复规划时运行 `node scripts/check-ai-context-budget.mjs` 的当前实测结果如下：

| 指标 | 当前实测 |
|---|---:|
| SessionStart 最大平台总量（Codex＋Astra） | 19,177 B |
| Codex state / rules / stages | 7,081 / 7,060 / 5,036 B |
| Claude state / rules / stages | 4,682 / 7,060 / 5,036 B |
| Codex 非 Astra / Astra 关闭 | 17,165 B |
| Claude | 16,778 B |
| 控制面合计 | 108,611 B |

默认检查仅在 `states-total` 与 `session-start` 报告既有 warning，未超过 review 上限；本任务不调整阈值。

## Candidate Text

以下只用于解释估算，不是已批准并完成行为验证的最终实现。

Phase 1.3 候选：

```text
- 1.3 Configure context `[required · once]` — configure task context before sub-agent dispatch; inline execution skips.
```

Codex 派发候选：

```text
Every sub-agent dispatch prompt, including `trellis-research`, must start with `Active task: <task path from task.py current>` before role-specific instructions. For implementation/check, enter `trellis-route` first and follow its execution-mode decision. Codex uses native `SubagentStart` context injection with child-side pull fallback.
```

## Relevant Sources

- `src/assets/flower_session_start.py`：Flower 分段包装器、Astra 提示、状态刷新和任务维护入口。`split_workflow()` 依赖 `### Planning Artifacts`。
- `.codex/hooks/session-start.py`、`.claude/hooks/session-start.py`：当前部署结果，用于核对实际正文，不应只修改部署副本。
- `vendor/skill-garden/.trellis/0.6/overrides/patches/workflow/hub/content.md`：归属表和跨阶段顺序的源 Patch 内容。
- `src/assets/flower_update_hook.py`：更新或项目不同步时注入动态确认上下文；无可处理事件时不输出该块。
- `src/commands/self-update.js`：更新结果中的 `trellis-push` 引导。
- `scripts/check-ai-context-budget.mjs`、`.trellis/spec/flower-trellis/cli/ai-context-budget.md`：真实输出计量和分层约束。
- `.trellis/spec/flower-trellis/cli/trellis-patch-engine.md`：分段、跨平台、模型提示和心跳契约。前序任务可能同步修改部分说明，恢复时重新核对。

## Required Spec Reads

- `trellis-patch-engine.md` 建档时为 59,112 字节，超过单文件注入的 32,768 字节上限；因此不将全文放入 JSONL，避免相关章节被截断。
- 实施和检查前，通过 `spec_router.py` 定位并完整读取该规范的 `Scenario: SessionStart Parts And Context Limit Preservation`、`Scenario: Conditional Workflow-State Injection And Heartbeat` 相关契约，以及实际改动命中的 Patch 所有权章节。
- 建档时前两组契约分别位于第 719–773 行和第 611–639 行；前序任务可能移动行号，必须重新按标题定位并遵循返回的加载策略。

## Historical Regressions

- 2026-07-08 会话 `019f3f78-fd26-7473-9afb-8a8ae723c284`，通过 `trellis mem context` 找到精简提交 `1f6e1cc3` 的历史审查：检查后停止、提交走 `trellis-push`、brainstorm 触发条件，以及规范发现后实际读取的要求曾被压弱。这是历史对话证据，不代表这些问题在当前代码中仍未修复。
- `.trellis/tasks/archive/2026-07/07-23-fix-spec-router-workflow-action-gate/prd.md`：记录规则迁移后真实入口不可达的回归，包括知识发现、planning 范围隔离、进度恢复、实现后 Pre-Check、直接 push 和平台覆盖。
- `.trellis/tasks/archive/2026-09/09-05-astra-workflow-hint/research/behavior-report.md`：60 次对照实验的六项预设指标无明显改善，另有探索性模板信号和工具开销增长。不能据此保证本任务压缩后的行为，也不能把注入成功等同于遵循率提升。

## Deferred Work

- 前序任务已经完成；当前继续补齐 `design.md`、`implement.md` 和最终 Brief。
- Brief 确认前不激活任务；实现阶段逐项验证平台裁剪、动态更新顺序、GC 无动作静默及全部受保护能力。

## Implementation Result（2026-09-23）

- 最终代码在同一隔离 fixture 中将 SessionStart 最大场景从 19,177 B 降至 18,087 B，实际减少
  1,090 B；没有调整 target、review ceiling 或 strict 判定规则。
- Codex 的 state / rules / stages 为 6,976 / 6,753 / 4,358 B；Claude 为
  4,577 / 6,753 / 4,275 B。Codex 非 Astra 场景为 16,075 B，Claude 场景为 15,605 B，
  控制面合计为 106,161 B。
- 固定的需要确认更新事件中，动态上下文由 669 B 增至 690 B，system message 由 173 B 增至
  229 B，完整 Hook JSON 载荷由 995 B 增至 1,072 B；CLI 安装引导由 1,037 B 增至 1,061 B，
  无命令诊断由 574 B 增至 598 B。增长来自把普通请求处理顺序移入真实事件，不属于常驻
  SessionStart 预算。
- `auto`、`ask`、项目不同步、带或不带 release notes、无命令 CLI 诊断均有定向回归；`auto`
  保留已有安全授权且不新增确认，诊断路径不执行子进程或生成安装命令。更新成功后的
  `run_trellis_push_confirmation` 契约保持不变。
- 完整 `npm test` 通过：JavaScript 611 项通过、2 项跳过，Python 465 项通过、2 项跳过；Patch
  冲突、compiled targets、默认预算和输出模板检查均通过。strict 预算检查也通过，dogfood 连续
  第二次更新报告目标变化 0 项，源资产与部署副本逐字节一致。
- 上述数字均为 UTF-8 bytes，不换算为模型 token。结构、入口、生成链和预算证据是确定性的；
  本轮未执行新的真实宿主模型对话实验，因此不据此宣称模型遵循率获得统计性提升。
