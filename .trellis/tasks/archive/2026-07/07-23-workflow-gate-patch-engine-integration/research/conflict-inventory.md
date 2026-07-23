# Workflow Gate 原有冲突清单

## Gate Ownership Conflicts

| Gate | 迁移前重复 / 冲突位置 | 选择的权威 owner | 处理动作 |
| --- | --- | --- | --- |
| Request Intent Routing | Hub、`Request Triage`、`trellis-start`、`no_task` state | `Request Triage`；`trellis-start`/state 为入口 | Hub 删除全文；Request Triage 原位扩展；start/state 保留一跳动作 |
| Brainstorm Gate | Hub、Phase 1.1、planning state、`trellis-brainstorm` | Phase 1.1 + `trellis-brainstorm` | Hub 删除全文；保留 planning state 短门禁和既有 skill handoff |
| Task Brief Handoff | Hub、Phase 1.4、planning state、`trellis-task-brief`、`task.py start` | Phase 1.4 + `trellis-task-brief` | Hub 删除全文；保留 task.py 确定性 brief guard |
| Project Knowledge Discovery | 仅 Hub 保存完整触发矩阵，owner 缺失 | `trellis-before-dev` | 新增现有 Patch Engine operation；brainstorm 只保留 owner 指针 |
| Flower Update Confirmation | Hub、SessionStart payload、`self-update` result | update hook / Flower CLI payload | Hub 删除执行细节；测试改为验证 runtime payload 和 push post_action |
| Active Task Scope Guard | Hub、in-progress state、`task_intent.py` | active workflow state | Hub 删除全文；state 在 route/edit 前执行一跳门禁，helper 保留 scope safety |
| Routing Gate | Hub、Active Task Routing、Phase 2、state、`trellis-route` | Phase 2 + `trellis-route` | Hub 删除 fallback/runtime 细节；保留 target-matched route 入口 |
| Auto-Loop Return Gate | Hub、Phase 2.1/2.2、state、Check-All、auto-loop | `trellis-check-all` + `trellis-auto-loop` | Hub 只保留“先 return 后 stop”的顺序；完整 record/next 在 skill |
| Interactive Post-Check Stop Gate | Hub、state、Phase 2.2、Check-All | Phase 2.2 + `trellis-check-all` | Hub 删除报告模板和 continuation 细节；state 保留一跳去向 |
| Code Commit Confirmation Gate | Hub、Phase 3.4、`trellis-push` | Phase 3.4 + `trellis-push` | Hub 删除 Git 规则和展示模板；保留 push owner 指针 |
| Auto-loop Commit-only Preauthorization | Hub、`trellis-auto-loop`、`trellis-push` | `trellis-auto-loop` | Hub 只保留授权不得泄漏的 owner 行；完整预检和 record 由 auto-loop 持有 |
| Bookkeeping Auto-commit Scope | Hub、`trellis-finish-work`、`safe_commit.py` | `trellis-finish-work` | Hub 删除 exact path / upstream 细节；finish skill 和 helper 保留完整边界 |
| Task Progress Recovery | Hub、`trellis-push`、`task_progress.py` | `trellis-push` recovery entry | Hub 删除 schema/提交细节；helper 改为原子写并补零副作用测试 |

## Patch And Upstream Conflicts

| 冲突类型 | 证据 | 决策与动作 |
| --- | --- | --- |
| Hub 与 owner 双轨 | Hub 原有 13 个 `#### ... Gate` section | 保持 `workflow-hub` operation ID，原位升级为 13 行 owner table；`conflicts.json` 禁止旧 section 回流 |
| 上游 Phase 2 直接 dispatch / auto-fix | 0.6.5 baseline 中 `Spawn the implement sub-agent`、`Auto-fix issues it finds` | 继续使用现有 Phase section replace；required/absent conflict rules 保持 |
| 上游 Phase 3.4 local-only | 0.6.5 baseline 中 `Never push to remote in this step` | 继续由 `workflow-phase-3-commit` replace 为 `trellis-push` |
| Request Triage 仍引用 Hub 边界 | 旧 content 含 `hub's direct_edit / task_plan boundary` | 原位替换为完整 Request Intent contract，不再依赖 Hub 正文 |
| Knowledge owner 缺失 | `spec_router.py` 存在，但只有 Hub 描述何时调用 | 新增 `before-dev-project-knowledge-discovery`，不新增 helper/schema |
| 精细 Bundle 缺 owner | `task-intent`/`workflow-enhancement` 只选择 intent-routing Bundle | 将 before-dev owner Patch 加入同一 Bundle；fresh/selected apply 测试验证自包含 |
| owner marker 重复 | Hub operation 已有稳定 managed marker | 保持 operation ID；`max-occurrences=1`；连续 dogfood 第二次修改 0 |
| progress 直接覆盖 | `task_progress.py` 使用 `Path.write_text` | 对齐 auto-loop/pre-check 的临时文件 + `fsync` + `os.replace`，替换失败保留旧文件 |

## Final Assertions

- `conflicts.json` 要求 Hub owner index、Request Triage owner、before-dev owner、active-task state owner 签名存在。
- `conflicts.json` 要求 13 个旧 Hub section heading 全部缺失。
- Hub marker 最大出现 1 次，禁止通过新 Patch ID 叠加第二份实现。
- `workflow-gate-ownership.test.js` 验证 13 个 Gate 的最终 owner 证据、Hub 禁止正文和跨阶段顺序。
