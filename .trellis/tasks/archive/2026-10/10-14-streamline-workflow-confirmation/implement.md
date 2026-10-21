# Implement — 减少检查后停顿并明确中途方案变更确认

## Execution

- [x] 用户确认首次完整 Brief 后执行 `task.py start`，任务进入 `in_progress`。
- [x] 进入 `trellis-route(target=implement)`，复用个人 `implement=inline`；通过 `trellis-before-dev` 加载匹配规范。
- [x] 修改 Check-All 的默认通过推进、显式停止、人工处置和 untracked 游标规则；同步 Workflow Phase 2.2、状态及 Update-Spec。
- [x] 在 Brief owner 集中增加首次确认后增量判断；同步 Brainstorm、Scope Guard/状态和完成恢复说明中的矛盾表述。
- [x] 保持 agents/claude 作者源逐字节一致，更新必要 conflict assertions。
- [x] 更新现有 Check-All/Update-Spec/Brief 回归，补齐决策分支和保留保护的最终产物断言。
- [x] 运行 `npm run sync` 和 `npm run patch:targets`，审阅实际源、快照和 compiled diff。
- [x] 用项目 Plugin 生命周期 dry-run 核对投影范围，再应用当前 dogfood；含当前投影一致性的测试需在该步骤后运行。
- [x] 完成定向验证、投影重复应用 changed-only 检查及 `npm test`；全量 JavaScript 642 项通过、2 项平台专属跳过，Python 498 项执行通过（含 2 项跳过），其余门禁通过。
- [x] 进入 `trellis-route(target=check)`，复用个人 `check=check-all-inline`，按统一 Check-All full 核对全部需求映射、假设、完整性与规范。
- [x] 按有效检查分流进入 Update-Spec，最小更新既有工作流契约并完成定向自校验。
- [x] 展示子仓→父仓的精确 Git 计划，用户确认后完成两仓业务提交/推送及快照、投影摘要同步。
- [x] 业务提交 `c13ebc2` 的三个跨平台 CI 工作流共 8 个 job 全部通过；进入任务完成态、Close 及任务记录提交。

## Validation Commands

```bash
node --test test/js/update-spec-auto-decision.test.js test/js/brief-preauthorization.test.js test/js/workflow-gate-ownership.test.js test/js/check-all-smart-depth.test.js test/js/apply-enhancements.test.js
npm run sync
npm run patch:targets
npm run patch:targets:check
node scripts/check-patch-conflicts.mjs
node scripts/check-output-templates.mjs
npm test
git diff --check
git -C vendor/skill-garden diff --check
```

- Python start guard、auto-loop 和 untracked 回归由 `npm test` 原有清单覆盖；未修改 helper 时不新增与实现逐行同构的 Python 测试。
- Plugin 命令沿用当前 CLI 帮助与受版本控制入口，实施前读取实际参数/调用签名，不猜测 API。
- 本次只改规则载荷和测试，不修改脚本入口/可执行命令；若实际实施新增可执行行为，再按质量规范补齐 Linux/Windows 必需 CI 验证并记录证据。

## Review Gates

- 初次开工：完整 Brief 展示后获得批准。
- 修复：Check-All 的普通问题由用户选择范围；原问题修复/重检复用既有路由。
- 变更：只对新增未决内容暂停，材料刷新不触发相同内容重复审批。
- Git：exact files/message/仓库顺序由 Push 统一展示，一次确认；本计划不授权 Git 写入。

## Rollback Points

- 源/快照/compiled 不一致时停在本地实施验证，不应用 dogfood。
- Plugin dry-run 范围含未知用户改动时先定位具体路径；不通过强制覆盖绕过。
- 发现需求或规则冲突时更新权威材料并按必要增量决定处理，不重复提交或伪造检查通过。

## Delivery Evidence

- Skill-Garden 作者源提交：`8689c04e7d3adf058c55a79ce6eca944424268b1`。
- Flower 业务提交及 CI headSha：`c13ebc2da1572e1fadd5eea7515440d1da3dc996`。
- [Python 跨平台兼容回归](https://github.com/SilentFlower/flower-trellis/actions/runs/38530626782)：Ubuntu/Windows × Python 3.8/3.12，4/4 job success。
- [SessionStart 跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/38530626878)：Ubuntu/Windows，2/2 job success。
- [更新链路跨平台回归](https://github.com/SilentFlower/flower-trellis/actions/runs/38530626899)：Ubuntu/Windows × Node 22，2/2 job success。
- 本地 JS 2 项 Windows 专属场景跳过；Python 2 项 Windows 专属扩展路径/CMD 场景跳过，原生平台结果以以上 CI job 为准。
