# Design — 减少检查后停顿并明确中途方案变更确认

## Boundaries

- 修改 Skill-Garden 0.6 的工作流与 Skill 规则文本、冲突策略断言及对应回归；不修改 CLI 参数、任务状态 schema、Python helper 或授权数据库。
- Check-All 继续负责检查、报告及后续分流；Update-Spec 负责最小规范评估/写入；Push 负责精确计划、人工确认和 Git 安全执行。
- Brief owner 负责区分首次完整评审与后续增量变更；Scope Guard 仍先确认事项归属，跨任务工作不得借此次优化混入。

## Check-All Continuation

保留 `Interactive Post-Check Stop Gate` 名称及 owner，改为先处理有效 auto-loop action，再按当前交付范围中的显式停止、检查结论和人工处置判断。

| 场景 | 下一动作 |
| --- | --- |
| 用户明确只检查、只读检查、检查后停止或暂不收尾 | 展示报告后停止，不运行 Update-Spec，不生成 Git 计划 |
| 严格通过，无 blocker、阻断型部分验证或未接受实质风险 | 展示检查报告后同轮进入 Update-Spec，不需要额外继续指令 |
| 剩余 findings 已由用户有效接受，且其它通过条件满足 | 使用既有增量展示，同轮进入 Update-Spec；显式停止仍优先 |
| 未处置 CHK/FBK | 一次展示问题和处置选项，由用户选择，不自动修复或接受风险 |
| blocker、提交前必需验证缺口或未归属风险 | 说明缺口并停止；解除后重检 |
| 仅存在既有 `[上线后验证]` | 按原规则保留非阻断风险，不执行生产/外部验证 |
| Update-Spec 返回 no-op / written | 同轮加载 Push 并展示计划；无可交付 diff 时报告无须提交，不制造空提交 |
| Update-Spec 返回 needs-review | 仅询问对应待决事项，不生成 Git 计划 |

- 原 direct Git 模式、显式继续模式成为默认通过路径的已有用例，仍保留原 commit-only/普通 Push 意图和最终确认范围。
- 不从检查通过推断 Git 写入授权；展示计划后等待确认。
- untracked 通过且默认推进时，从 check advance 到 spec；显式停止时保持 check；问题/阻塞按现有规则返回对应阶段。
- 普通检查发现的代码问题仍 audit-only；DOC 白名单、黑名单和写入时机保持原规则。

## Brief And Change Decisions

在 `trellis-task-brief` 中集中定义方案变更判断，Brainstorm、workflow state 和 Meta 恢复说明只引用 owner，避免各维护一套阈值。

| 时点/变化 | 文档动作 | 用户交互 |
| --- | --- | --- |
| 首次规划收敛前 | 持续更新权威材料 | 仅询问尚未解决的产品决定，不每次发完整 Brief |
| 首次开工 | 从最终材料刷新 Brief | 完整展示并等待确认，沿用原明确预授权例外 |
| 已确认目标/范围/验收内的实现细节调整 | 更新必要设计/计划；交接视图确需同步时以材料派生 | 简述调整后继续，不重复 Brief 审批 |
| 用户明确覆盖 A→B 及其影响，且无新增待决事项 | 先同步受影响权威材料和 Brief | 当前指令就是该增量的决定，不再询问同一调整 |
| 助手提出尚未明确决定的目标、范围、验收或风险变化 | 整理相对已批准内容的增量与影响 | 只请用户决定增量；未决部分不实施，已确认部分不重复审批 |
| 恢复会话或上下文压缩 | 读取实际材料和可验证决定；证据不足时只定位缺口 | 恢复本身不触发完整重新确认，也不从摘要猜测批准 |
| 已完成任务返工 | 先遵守原显式 reopen 流程 | 返工授权与变更决定区分，相关新范围仍走增量判断 |

- 首次 Brief 未批准时不能以用户在讨论中修改一项需求替代首次完整评审。
- “文档更新”和“授权变化”分别判断：mtime guard 仍要求 planning task 的 Brief 新鲜，但刷新不自动推定通过或失效。
- 产品取舍、未说明的新影响及独立权限/生产/数据/费用/外部/破坏性边界不能靠 A→B 的泛化指令自动扩大。
- 首次确认后的方案改变若需要等待用户，只展示差异和待决事项；用户要求查看全貌时才完整展示更新的 Brief。

## Authoring Targets

核心修改组：

1. `.agents/.claude/skills/trellis-check-all/references/reporting-and-disposition.md` 和必要的薄入口描述。
2. `overrides/patches/workflow/phase-ownership/phase-2-check-content.md`、`states-in-progress/common-content.md` 及必要的 owner 指针。
3. `overrides/patches/skills/trellis-update-spec/autonomous-evaluation/content.md` 的 Workflow Disposition。
4. `.agents/.claude/skills/trellis-task-brief/SKILL.md`、Brainstorm planning-handoff 的 readiness/review/handoff 载荷。
5. 运行态/已完成恢复说明及 Meta continue-recovery 载荷中与 Brief 重复审批冲突的表述；Scope Guard 仅引用变更 owner，不扩大事项归属许可。
6. `overrides/conflicts.json` 与父仓对应测试；同步 snapshot、compiled targets 和当前 dogfood。

所有 selector/baseline 原文保持精确匹配；英文目标载荷继续用英文，中文 Skill 正文用中文。

## Validation And Compatibility

- 定向回归覆盖严格通过、已接受风险、显式只检查、未处置 findings、阻塞、needs-review、untracked 游标和 auto-loop 返回。
- Brief 回归覆盖首次完整评审、预授权窄例外、细节变化、用户明确增量、未决范围变化、恢复和首次未批准。
- 使用现有最终产物与 owner 断言验证规则分发；不创建模拟用户批准的解析器来代替实际交互规则。
- 全量 `npm test` 包含源/快照一致性、Patch conflict、compiled targets、输出模板和预算门禁。
- 自动化能验证规则文本和分发的一致性；真实宿主的自然语言执行效果需结合具体会话观察，不能据静态测试宣称所有模型行为已验证。

## Delivery And Rollback

- 当前任务先规划，首次完整 Brief 获确认后才实施。
- 实现、定向验证和 Check-All 完成后按生效的推进 owner 行为进入规范评估/精确提交方案；若当前会话仍受旧注入约束，按实际生效规则说明必要停顿，不假装新规则已覆盖历史指令。
- 子仓源与 compiled 产物、父仓 submodule pin/快照/测试/spec 分属各自 Git root；未来 Push 计划按实际 diff 列出精确文件，未经确认不提交。
- 失败时保留实际 diff 和 Plugin 事务证据，先在所属源修复；不手改受管输出，也不 reset 已有用户内容。
